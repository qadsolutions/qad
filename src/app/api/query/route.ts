/**
 * POST /api/query — the RAG query endpoint (issue #30).
 *
 * Pipeline (CLAUDE.md "Core Data Flow"):
 *   embed question → tenant-filtered vector search → build grounded prompt →
 *   stream the model's answer to the browser (Vercel AI SDK / SSE-style text stream).
 *
 * SECURITY: wrapped in `withTenant` (SECURITY.md §3), so it only runs for a verified,
 * active, non-`platform_admin` token. Every write is scoped to `tenant.tenantId` — the id
 * from the validated JWT, never the request body. Persistence (conversations, messages,
 * retrieval_logs, model_calls) goes through the service-role admin client because those
 * tables grant `authenticated` SELECT only; writes are service_role-only by RLS design
 * (see admin.ts). The same admin client also backs the rate-limit RPC.
 *
 * CITATIONS over a stream: the chunk ids actually used are known *before* inference (they
 * come from `buildPrompt`), and HTTP headers are flushed before the streamed body. So we
 * surface citations as an `X-Citations` response header (a JSON array of chunk_id
 * strings) — it survives streaming and needs no in-band protocol the client must parse out
 * of the token stream. The same ids are persisted to `retrieval_logs`.
 *
 * PERSISTENCE (folds in conversation history groundwork, #40): each query persists a
 * conversation (reused if the caller passed one it owns, else created), the user message,
 * and — once inference finishes — the assistant message, a retrieval_logs row, and a
 * best-effort model_calls row. The assistant-side writes run in the inference provider's
 * `onFinish`, which every provider completes before the response stream closes.
 */

import { withTenant, type TenantRouteHandler } from "@/lib/auth/with-tenant";
import { createEmbedder } from "@/lib/ingestion/embedder";
import {
  createInferenceProvider,
  type InferenceFinish,
} from "@/lib/inference/provider";
import { buildPrompt } from "@/lib/rag/prompt";
import { searchSimilarChunks } from "@/lib/rag/retrieval";
import { checkQueryRateLimit } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/** Canned answer when retrieval returns nothing — matches the prompt's grounding rule. */
const EMPTY_CONTEXT_ANSWER =
  "I don't have that information in the available documents.";

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status });
}

interface QueryBody {
  question: string;
  conversation_id?: string;
}

/** Parse and validate the request body. Returns the trimmed question on success. */
function parseBody(raw: unknown): { question: string; conversationId?: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Partial<QueryBody>;
  if (typeof body.question !== "string") return null;
  const question = body.question.trim();
  if (question.length === 0) return null;
  const conversationId =
    typeof body.conversation_id === "string" && body.conversation_id.length > 0
      ? body.conversation_id
      : undefined;
  return { question, conversationId };
}

/**
 * Resolve the conversation to attach this query to: reuse `conversationId` only if it
 * exists AND belongs to `tenantId` (verified via the admin client, explicitly scoped to
 * tenant_id — never trust the body's id alone); otherwise create a new conversation. The
 * created/looked-up id is returned for the message rows.
 */
async function resolveConversationId(
  admin: TypedSupabaseClient,
  tenantId: string,
  userId: string,
  question: string,
  conversationId: string | undefined,
): Promise<string> {
  if (conversationId) {
    const { data, error } = await admin
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!error && data) return data.id;
    // Not found / not this tenant's / lookup error → fall through and create a fresh one.
  }

  const newId = crypto.randomUUID();
  // Seed a title from the question so the M6/M7 conversation list has a label; the column
  // is plain text, so a short slice is enough and avoids unbounded titles.
  const title = question.length > 80 ? `${question.slice(0, 77)}...` : question;
  await admin.from("conversations").insert({
    id: newId,
    tenant_id: tenantId,
    user_id: userId,
    title,
  });
  return newId;
}

/** Insert a message row scoped to the tenant; returns the generated id. */
async function insertMessage(
  admin: TypedSupabaseClient,
  tenantId: string,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await admin.from("messages").insert({
    id,
    tenant_id: tenantId,
    conversation_id: conversationId,
    role,
    content,
  });
  return id;
}

/**
 * Persist the assistant turn: the assistant message, its retrieval log (the chunk ids +
 * aligned similarity scores actually used), and a best-effort model_calls row. The
 * model_calls insert is wrapped so a logging failure never breaks the user's response —
 * the answer has already streamed. Returns nothing; callers fire this from `onFinish`.
 */
async function persistAssistantTurn(
  admin: TypedSupabaseClient,
  tenantId: string,
  userId: string,
  conversationId: string,
  answer: string,
  chunkIdsUsed: string[],
  similarityScores: number[],
  modelName: string,
  usage: { promptTokens: number; completionTokens: number },
  latencyMs: number,
): Promise<void> {
  const assistantMessageId = await insertMessage(
    admin,
    tenantId,
    conversationId,
    "assistant",
    answer,
  );

  await admin.from("retrieval_logs").insert({
    message_id: assistantMessageId,
    tenant_id: tenantId,
    chunk_ids: chunkIdsUsed,
    similarity_scores: similarityScores,
  });

  // Best-effort usage accounting — must not fail the (already-streamed) response.
  try {
    await admin.from("model_calls").insert({
      tenant_id: tenantId,
      user_id: userId,
      model_name: modelName,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      latency_ms: latencyMs,
    });
  } catch (err) {
    console.error(
      `model_calls insert failed for tenant ${tenantId} user ${userId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Exported for direct unit testing with a mocked context (mirrors `uploadHandler`).
 * The `POST` export below wraps it in `withTenant`.
 */
export const queryHandler: TenantRouteHandler = async (req, { tenant }) => {
  // Service-role client: the only write path for chat persistence + the rate-limit RPC.
  const admin = createSupabaseAdminClient();

  // 1. Per-tenant/per-user query cap (#62) — checked first, before any embedding/search.
  const rate = await checkQueryRateLimit(admin, tenant.tenantId, tenant.userId);
  if (!rate.allowed) {
    return errorResponse(
      429,
      "rate_limited",
      `Query rate limit reached (${rate.limit} per minute). Try again shortly.`,
    );
  }

  // 2. Parse + validate the body.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse(400, "invalid_request", "Expected a JSON body with a question field");
  }
  const parsed = parseBody(raw);
  if (!parsed) {
    return errorResponse(400, "invalid_request", "A non-empty question is required");
  }
  const { question, conversationId } = parsed;

  // 3. Resolve the conversation and record the user turn up front (so history exists even
  // if inference later errors). All writes scoped to the validated token's tenant.
  const conversation = await resolveConversationId(
    admin,
    tenant.tenantId,
    tenant.userId,
    question,
    conversationId,
  );
  await insertMessage(admin, tenant.tenantId, conversation, "user", question);

  // 4. Embed the question and run tenant-filtered vector search.
  const [embedding] = await createEmbedder().embed([question]);
  const chunks = await searchSimilarChunks(admin, tenant.tenantId, embedding);

  const built = buildPrompt(
    question,
    chunks.map((c) => ({ chunkId: c.chunkId, chunkText: c.chunkText, similarity: c.similarity })),
  );
  // Similarity scores aligned to the cited chunk ids (presentation order from buildPrompt).
  const similarityById = new Map(chunks.map((c) => [c.chunkId, c.similarity]));
  const similarityScores = built.chunkIdsUsed.map((id) => similarityById.get(id) ?? 0);

  const citationsHeader = { "X-Citations": JSON.stringify(built.chunkIdsUsed) };

  // 5a. Empty-context guardrail: when retrieval returns nothing, short-circuit BEFORE
  // inference (prompt.ts documents this) — return the canned answer and still persist the
  // assistant message + an empty retrieval log. No model_calls row (no model was called).
  if (built.chunkIdsUsed.length === 0) {
    const assistantMessageId = await insertMessage(
      admin,
      tenant.tenantId,
      conversation,
      "assistant",
      EMPTY_CONTEXT_ANSWER,
    );
    await admin.from("retrieval_logs").insert({
      message_id: assistantMessageId,
      tenant_id: tenant.tenantId,
      chunk_ids: [],
      similarity_scores: [],
    });
    // Trivially stream the canned text so the client sees one consistent response shape.
    return new Response(EMPTY_CONTEXT_ANSWER, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...citationsHeader },
    });
  }

  // 5b. Stream the grounded answer. Persistence runs in onFinish, which the provider
  // completes before the response stream closes.
  const provider = createInferenceProvider();
  const startedAt = Date.now();
  const result = provider.streamChat({
    system: built.system,
    prompt: built.user,
    onFinish: async (finish: InferenceFinish) => {
      await persistAssistantTurn(
        admin,
        tenant.tenantId,
        tenant.userId,
        conversation,
        finish.text,
        built.chunkIdsUsed,
        similarityScores,
        provider.modelName,
        finish.usage,
        Date.now() - startedAt,
      );
    },
  });

  return result.toResponse({ status: 200, headers: citationsHeader });
};

export const POST = withTenant(queryHandler);
