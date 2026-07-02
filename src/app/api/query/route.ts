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
 * `onFinish`, which every provider completes before a *normal* stream close. Caveat: if the
 * client aborts mid-stream, `onFinish` may not fire, so the assistant-side rows can be
 * absent (the user turn is already committed). Acceptable at prototype scale; abort-safe
 * persistence is tracked for M10 hardening.
 *
 * WRITE FAILURE POLICY: the two writes that must exist before any answer — creating the
 * conversation and recording the user turn — are checked and return 500 on failure (a
 * corrupt/absent conversation would make the whole exchange meaningless). The post-answer
 * writes (assistant message, retrieval log, model_calls) are best-effort and only logged:
 * the answer has already been decided/streamed, so a logging failure must not surface as an
 * error to the user — but it must never be swallowed silently either.
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

/**
 * Upper bound on a question's length. Guards the embed (Ollama compute), the DB write, and
 * the tokens forwarded to inference against an oversized single request — the per-user rate
 * cap limits frequency, but not the size of any one question. Generous vs. a normal query.
 */
const MAX_QUESTION_CHARS = 8000;

/** Parse and validate the request body. Returns the trimmed question on success. */
function parseBody(raw: unknown): { question: string; conversationId?: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Partial<QueryBody>;
  if (typeof body.question !== "string") return null;
  const question = body.question.trim();
  if (question.length === 0 || question.length > MAX_QUESTION_CHARS) return null;
  const conversationId =
    typeof body.conversation_id === "string" && body.conversation_id.length > 0
      ? body.conversation_id
      : undefined;
  return { question, conversationId };
}

/**
 * Resolve the conversation to attach this query to: reuse `conversationId` only if it
 * exists AND belongs to this `userId` within this `tenantId` (verified via the admin
 * client, explicitly scoped — never trust the body's id alone); otherwise create a new
 * conversation. Scoping by user_id (not tenant_id alone) matters because a tenant is
 * multi-user (M6 Client Portal): without it, any user could append their turn to another
 * same-tenant user's thread just by passing its id. Returns the conversation id, or null
 * if creating a fresh conversation failed (logged) — the caller turns that into a 500,
 * since nothing else can attach without it.
 */
async function resolveConversationId(
  admin: TypedSupabaseClient,
  tenantId: string,
  userId: string,
  question: string,
  conversationId: string | undefined,
): Promise<string | null> {
  if (conversationId) {
    const { data, error } = await admin
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      // A genuine backend failure — log it (don't let it masquerade as a benign
      // "not found"), then fall through and create a fresh conversation. This keeps the
      // module's "no silently-swallowed errors" contract.
      console.error(`conversation lookup failed for tenant ${tenantId}: ${error.message}`);
    } else if (data) {
      return data.id;
    }
    // Not found / not this user's / logged lookup error → fall through, create a fresh one.
  }

  const newId = crypto.randomUUID();
  // Seed a title from the question so the M6/M7 conversation list has a label; the column
  // is plain text, so a short slice is enough and avoids unbounded titles.
  const title = question.length > 80 ? `${question.slice(0, 77)}...` : question;
  const { error } = await admin.from("conversations").insert({
    id: newId,
    tenant_id: tenantId,
    user_id: userId,
    title,
  });
  if (error) {
    console.error(`conversation insert failed for tenant ${tenantId}: ${error.message}`);
    return null;
  }
  return newId;
}

/**
 * Insert a message row scoped to the tenant. Returns the generated id, or null on failure
 * (logged). The caller decides whether that's fatal (the user turn, pre-answer → 500) or
 * best-effort (the assistant turn, post-answer → just logged).
 */
async function insertMessage(
  admin: TypedSupabaseClient,
  tenantId: string,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
): Promise<string | null> {
  const id = crypto.randomUUID();
  const { error } = await admin.from("messages").insert({
    id,
    tenant_id: tenantId,
    conversation_id: conversationId,
    role,
    content,
  });
  if (error) {
    console.error(`message insert (${role}) failed for tenant ${tenantId}: ${error.message}`);
    return null;
  }
  return id;
}

/** Best-effort retrieval log for an assistant message — logs on failure, never throws. */
async function insertRetrievalLog(
  admin: TypedSupabaseClient,
  tenantId: string,
  messageId: string,
  chunkIds: string[],
  similarityScores: number[],
): Promise<void> {
  const { error } = await admin.from("retrieval_logs").insert({
    message_id: messageId,
    tenant_id: tenantId,
    chunk_ids: chunkIds,
    similarity_scores: similarityScores,
  });
  if (error) {
    console.error(`retrieval_logs insert failed for tenant ${tenantId}: ${error.message}`);
  }
}

/**
 * Persist the assistant turn: the assistant message, its retrieval log (the chunk ids +
 * aligned similarity scores actually used), and a best-effort model_calls row. ALL writes
 * here are post-answer — the response has already streamed — so each only logs on failure
 * and never throws. If the assistant message itself can't be written, the retrieval log is
 * skipped (it has nothing to attach to). Callers fire this from the provider's `onFinish`.
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
  const assistantMessageId = await insertMessage(admin, tenantId, conversationId, "assistant", answer);
  if (assistantMessageId) {
    await insertRetrievalLog(admin, tenantId, assistantMessageId, chunkIdsUsed, similarityScores);
  }

  // Best-effort usage accounting — must not fail the (already-streamed) response. Like the
  // other post-answer writes, PostgREST returns failures in `{ error }` (it doesn't throw),
  // so we check + log, consistent with insertMessage/insertRetrievalLog (no try/catch).
  const { error } = await admin.from("model_calls").insert({
    tenant_id: tenantId,
    user_id: userId,
    model_name: modelName,
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    latency_ms: latencyMs,
  });
  if (error) {
    console.error(`model_calls insert failed for tenant ${tenantId} user ${userId}: ${error.message}`);
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
    return errorResponse(
      400,
      "invalid_request",
      `A non-empty question of at most ${MAX_QUESTION_CHARS} characters is required`,
    );
  }
  const { question, conversationId } = parsed;

  // 3. Resolve the conversation and record the user turn up front (so history exists even
  // if inference later errors). These two writes must succeed — a missing conversation or
  // user message makes the exchange meaningless — so a failure is a 500, not best-effort.
  const conversation = await resolveConversationId(
    admin,
    tenant.tenantId,
    tenant.userId,
    question,
    conversationId,
  );
  if (!conversation) {
    return errorResponse(500, "internal_error", "Failed to record the conversation");
  }
  const userMessageId = await insertMessage(admin, tenant.tenantId, conversation, "user", question);
  if (!userMessageId) {
    return errorResponse(500, "internal_error", "Failed to record the message");
  }

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
  // assistant message + an empty retrieval log (best-effort). No model_calls (no model ran).
  if (built.chunkIdsUsed.length === 0) {
    const assistantMessageId = await insertMessage(
      admin,
      tenant.tenantId,
      conversation,
      "assistant",
      EMPTY_CONTEXT_ANSWER,
    );
    if (assistantMessageId) {
      await insertRetrievalLog(admin, tenant.tenantId, assistantMessageId, [], []);
    }
    // Plain text response for the canned answer — same content-type as the streamed path,
    // so the client sees one consistent response shape.
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
