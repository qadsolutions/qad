import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { queryHandler, POST } from "@/app/api/query/route";
import { withTenant, type TenantHandlerContext } from "@/lib/auth/with-tenant";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createEmbedder } from "@/lib/ingestion/embedder";
import { searchSimilarChunks, type ChunkMatch } from "@/lib/rag/retrieval";
import {
  createInferenceProvider,
  type ChatStreamResult,
  type InferenceProvider,
  type StreamChatOptions,
} from "@/lib/inference/provider";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/**
 * Unit tests for POST /api/query (issue #30).
 *
 * The admin client, embedder, retrieval, and inference provider are mocked so the route's
 * orchestration is tested in isolation — no Supabase, Ollama, or Groq is contacted. We
 * assert the pipeline order (rate-limit → parse → persist user turn → embed → search →
 * build → stream), that citations are surfaced via the X-Citations header, that the
 * conversation/messages/retrieval_logs/model_calls writes are scoped to the *context*
 * tenant_id, and that the empty-context path skips inference entirely.
 */

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/ingestion/embedder", () => ({ createEmbedder: vi.fn() }));
vi.mock("@/lib/rag/retrieval", () => ({ searchSimilarChunks: vi.fn() }));
vi.mock("@/lib/inference/provider", () => ({ createInferenceProvider: vi.fn() }));

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_A = "11111111-1111-1111-1111-111111111111";
const RESET_AT = "2026-06-29T10:01:00.000Z";

function ctx(): TenantHandlerContext {
  return {
    tenant: { tenantId: TENANT_A, userId: USER_A, role: "user" },
    // The query handler writes via the admin client, not this RLS one — unused here.
    supabase: {} as TypedSupabaseClient,
  };
}

interface AdminInserts {
  conversations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  retrieval_logs: Array<Record<string, unknown>>;
  model_calls: Array<Record<string, unknown>>;
}

/**
 * Mock service-role client. Records inserts per table, drives the conversation-ownership
 * lookup, and answers the rate-limit RPC with a configurable post-increment count.
 */
function mockAdmin(
  opts: {
    currentCount?: number;
    conversationLookup?: { id: string } | null;
  } = {},
) {
  const inserts: AdminInserts = {
    conversations: [],
    messages: [],
    retrieval_logs: [],
    model_calls: [],
  };

  const rpc = vi.fn(async () => ({
    data: [{ current_count: opts.currentCount ?? 1, reset_at: RESET_AT }],
    error: null,
  }));

  const from = vi.fn((table: keyof AdminInserts) => {
    const insert = vi.fn(async (row: Record<string, unknown>) => {
      inserts[table].push(row);
      return { error: null };
    });
    // conversations ownership lookup: select("id").eq("id").eq("tenant_id").maybeSingle()
    const maybeSingle = vi.fn(async () => ({
      data: opts.conversationLookup ?? null,
      error: null,
    }));
    const eqTenant = vi.fn(() => ({ maybeSingle }));
    const eqId = vi.fn(() => ({ eq: eqTenant }));
    const select = vi.fn(() => ({ eq: eqId }));
    return { insert, select };
  });

  const client = { rpc, from } as unknown as TypedSupabaseClient;
  vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
  return { inserts, rpc, from };
}

/** Stub the embedder with a fixed vector (retrieval is mocked, so the value is unused). */
function mockEmbedder() {
  vi.mocked(createEmbedder).mockReturnValue({
    modelVersion: "mock",
    embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  });
}

function mockRetrieval(chunks: ChunkMatch[]) {
  vi.mocked(searchSimilarChunks).mockResolvedValue(chunks);
}

/**
 * Fake inference provider: streams a fixed answer and runs onFinish (with usage) before
 * the stream closes — the same ordering the real providers guarantee — so draining the
 * response body in a test deterministically triggers the route's persistence.
 */
function mockProvider(answer = "Streamed answer [1]."): { streamChat: ReturnType<typeof vi.fn> } {
  const streamChat = vi.fn((options: StreamChatOptions): ChatStreamResult => ({
    toResponse(init?: ResponseInit): Response {
      const encoder = new TextEncoder();
      let sent = false;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (!sent) {
            controller.enqueue(encoder.encode(answer));
            sent = true;
            return;
          }
          if (options.onFinish) {
            await options.onFinish({ text: answer, usage: { promptTokens: 7, completionTokens: 4 } });
          }
          controller.close();
        },
      });
      const headers = new Headers(init?.headers);
      if (!headers.has("Content-Type")) headers.set("Content-Type", "text/plain; charset=utf-8");
      return new Response(stream, { ...init, headers });
    },
  }));
  const provider = { modelName: "mock-model", streamChat } as unknown as InferenceProvider;
  vi.mocked(createInferenceProvider).mockReturnValue(provider);
  return { streamChat };
}

function chunk(id: string, text: string, similarity: number): ChunkMatch {
  return { chunkId: id, documentId: `doc-${id}`, chunkText: text, similarity };
}

function queryRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("RATE_LIMIT_QUERIES_PER_MINUTE", "10");
});

describe("queryHandler", () => {
  it("runs the full pipeline, returns citations, streams the answer, and persists the turn", async () => {
    const admin = mockAdmin();
    mockEmbedder();
    mockRetrieval([chunk("c1", "alpha context", 0.9), chunk("c2", "beta context", 0.8)]);
    const { streamChat } = mockProvider("Grounded answer [1][2].");

    const res = await queryHandler(queryRequest({ question: "What is alpha?" }), ctx());

    expect(res.status).toBe(200);
    // Citations surfaced as a header (survives streaming) — the two retrieved chunk ids.
    expect(JSON.parse(res.headers.get("X-Citations") ?? "null")).toEqual(["c1", "c2"]);

    const body = await res.text();
    expect(body).toBe("Grounded answer [1][2].");

    // Retrieval ran against the admin client with the *context* tenant id.
    expect(searchSimilarChunks).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_A,
      [0.1, 0.2, 0.3],
    );
    expect(streamChat).toHaveBeenCalledOnce();

    // A fresh conversation was created (no conversation_id supplied), scoped to the tenant.
    expect(admin.inserts.conversations).toHaveLength(1);
    expect(admin.inserts.conversations[0]).toMatchObject({ tenant_id: TENANT_A, user_id: USER_A });

    // User + assistant messages, both tenant-scoped, in order.
    expect(admin.inserts.messages).toHaveLength(2);
    expect(admin.inserts.messages[0]).toMatchObject({
      tenant_id: TENANT_A,
      role: "user",
      content: "What is alpha?",
    });
    expect(admin.inserts.messages[1]).toMatchObject({
      tenant_id: TENANT_A,
      role: "assistant",
      content: "Grounded answer [1][2].",
    });

    // Retrieval log records the cited ids + aligned scores, scoped to the tenant.
    expect(admin.inserts.retrieval_logs).toHaveLength(1);
    expect(admin.inserts.retrieval_logs[0]).toMatchObject({
      tenant_id: TENANT_A,
      chunk_ids: ["c1", "c2"],
      similarity_scores: [0.9, 0.8],
    });

    // Best-effort model_calls row with usage + the provider's model name.
    expect(admin.inserts.model_calls).toHaveLength(1);
    expect(admin.inserts.model_calls[0]).toMatchObject({
      tenant_id: TENANT_A,
      user_id: USER_A,
      model_name: "mock-model",
      prompt_tokens: 7,
      completion_tokens: 4,
    });
  });

  it("reuses an existing conversation that belongs to the tenant", async () => {
    const CONV = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const admin = mockAdmin({ conversationLookup: { id: CONV } });
    mockEmbedder();
    mockRetrieval([chunk("c1", "ctx", 0.7)]);
    mockProvider();

    const res = await queryHandler(
      queryRequest({ question: "Follow up?", conversation_id: CONV }),
      ctx(),
    );
    await res.text();

    // No new conversation created; messages attach to the existing one.
    expect(admin.inserts.conversations).toHaveLength(0);
    expect(admin.inserts.messages[0]).toMatchObject({ conversation_id: CONV });
    expect(admin.inserts.messages[1]).toMatchObject({ conversation_id: CONV });
  });

  it("returns 429 before any work when the query rate limit is exceeded", async () => {
    const admin = mockAdmin({ currentCount: 11 }); // post-increment count over the limit of 10
    mockEmbedder();
    mockRetrieval([]);

    const res = await queryHandler(queryRequest({ question: "hi" }), ctx());

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ error: "rate_limited" });
    // Nothing else ran: no embedding, no search, no persistence.
    expect(createEmbedder).not.toHaveBeenCalled();
    expect(searchSimilarChunks).not.toHaveBeenCalled();
    expect(admin.inserts.conversations).toHaveLength(0);
    expect(admin.inserts.messages).toHaveLength(0);
  });

  it("returns 400 on an empty question", async () => {
    mockAdmin();
    const res = await queryHandler(queryRequest({ question: "   " }), ctx());
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_request" });
    expect(createEmbedder).not.toHaveBeenCalled();
  });

  it("returns 400 on a malformed JSON body", async () => {
    mockAdmin();
    const res = await queryHandler(queryRequest("{not valid json"), ctx());
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_request" });
  });

  it("short-circuits the empty-context case: canned answer, no inference, empty log", async () => {
    const admin = mockAdmin();
    mockEmbedder();
    mockRetrieval([]); // retrieval returns nothing
    const { streamChat } = mockProvider();

    const res = await queryHandler(queryRequest({ question: "unknown topic?" }), ctx());

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("I don't have that information in the available documents.");
    expect(JSON.parse(res.headers.get("X-Citations") ?? "null")).toEqual([]);

    // Inference was never selected or called.
    expect(createInferenceProvider).not.toHaveBeenCalled();
    expect(streamChat).not.toHaveBeenCalled();

    // Still persisted: user + assistant message, and an empty retrieval log. No model_calls.
    expect(admin.inserts.messages).toHaveLength(2);
    expect(admin.inserts.messages[1]).toMatchObject({
      role: "assistant",
      content: "I don't have that information in the available documents.",
    });
    expect(admin.inserts.retrieval_logs).toHaveLength(1);
    expect(admin.inserts.retrieval_logs[0]).toMatchObject({ chunk_ids: [], similarity_scores: [] });
    expect(admin.inserts.model_calls).toHaveLength(0);
  });
});

describe("POST /api/query (wrapped in withTenant)", () => {
  it("returns 401 and never runs the handler when the JWT is missing", async () => {
    const admin = mockAdmin();
    const authClient = {
      auth: { getClaims: vi.fn(async () => ({ data: null, error: null })) },
      from: vi.fn(),
    } as unknown as TypedSupabaseClient;
    const route = withTenant(queryHandler, { createClient: async () => authClient });

    const res = await route(queryRequest({ question: "hi" }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "unauthorized" });
    expect(admin.inserts.messages).toHaveLength(0);
  });

  it("exports POST as the wrapped handler", () => {
    expect(typeof POST).toBe("function");
  });
});
