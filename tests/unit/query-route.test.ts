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
    /** Force the conversation ownership lookup (maybeSingle) to return a backend error. */
    conversationLookupError?: { message: string };
    /** Force a given table's insert to return an error (drives the 500 / best-effort paths). */
    insertErrors?: Partial<Record<keyof AdminInserts, { message: string }>>;
  } = {},
) {
  const inserts: AdminInserts = {
    conversations: [],
    messages: [],
    retrieval_logs: [],
    model_calls: [],
  };

  // Every .eq(column, value) applied to the conversations ownership lookup, so tests can
  // assert the scoping filters (id + tenant_id + user_id).
  const conversationFilters: Array<[string, unknown]> = [];

  const rpc = vi.fn(async () => ({
    data: [{ current_count: opts.currentCount ?? 1, reset_at: RESET_AT }],
    error: null,
  }));

  const from = vi.fn((table: keyof AdminInserts) => {
    const insert = vi.fn(async (row: Record<string, unknown>) => {
      const error = opts.insertErrors?.[table] ?? null;
      if (!error) inserts[table].push(row);
      return { error };
    });
    // conversations lookup: select("id").eq("id").eq("tenant_id").eq("user_id").maybeSingle().
    // Fluent chain records each .eq filter and supports any number of them.
    const maybeSingle = vi.fn(async () => ({
      data: opts.conversationLookupError ? null : (opts.conversationLookup ?? null),
      error: opts.conversationLookupError ?? null,
    }));
    const selectChain = {
      eq: vi.fn((column: string, value: unknown) => {
        conversationFilters.push([column, value]);
        return selectChain;
      }),
      maybeSingle,
    };
    const select = vi.fn(() => selectChain);
    return { insert, select };
  });

  const client = { rpc, from } as unknown as TypedSupabaseClient;
  vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
  return { inserts, rpc, from, conversationFilters };
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

  it("reuses an existing conversation owned by the same user, scoped by user_id", async () => {
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

    // Ownership lookup is scoped by user_id (not tenant alone) — a same-tenant user must not
    // be able to hijack another user's conversation by passing its id (#106 review finding).
    expect(admin.conversationFilters).toContainEqual(["tenant_id", TENANT_A]);
    expect(admin.conversationFilters).toContainEqual(["user_id", USER_A]);
  });

  it("returns 400 on an oversized question (length guard)", async () => {
    mockAdmin();
    const res = await queryHandler(queryRequest({ question: "x".repeat(8001) }), ctx());
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_request" });
    expect(createEmbedder).not.toHaveBeenCalled();
  });

  it("accepts a question of exactly the max length (boundary)", async () => {
    mockAdmin();
    mockEmbedder();
    mockRetrieval([chunk("c1", "ctx", 0.8)]);
    mockProvider();
    const res = await queryHandler(queryRequest({ question: "x".repeat(8000) }), ctx());
    expect(res.status).toBe(200);
    await res.text();
    expect(createEmbedder).toHaveBeenCalledOnce();
  });

  it("creates a fresh conversation when the supplied id isn't the user's (fallback)", async () => {
    const admin = mockAdmin({ conversationLookup: null }); // lookup finds nothing
    mockEmbedder();
    mockRetrieval([chunk("c1", "ctx", 0.8)]);
    mockProvider();

    const res = await queryHandler(
      queryRequest({ question: "hi", conversation_id: "dddddddd-dddd-dddd-dddd-dddddddddddd" }),
      ctx(),
    );
    await res.text();

    // A fresh conversation is created; messages attach to it, not the (rejected) supplied id.
    expect(admin.inserts.conversations).toHaveLength(1);
    const newId = admin.inserts.conversations[0].id;
    expect(admin.inserts.messages[0]).toMatchObject({ conversation_id: newId });
  });

  it("logs and falls back to a fresh conversation when the ownership lookup errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = mockAdmin({ conversationLookupError: { message: "lookup boom" } });
    mockEmbedder();
    mockRetrieval([chunk("c1", "ctx", 0.8)]);
    mockProvider();

    const res = await queryHandler(
      queryRequest({ question: "hi", conversation_id: "dddddddd-dddd-dddd-dddd-dddddddddddd" }),
      ctx(),
    );
    await res.text();

    expect(res.status).toBe(200);
    // A genuine lookup error is logged (not silently treated as "not found")…
    expect(errorSpy).toHaveBeenCalled();
    // …and a fresh conversation is still created so the query proceeds.
    expect(admin.inserts.conversations).toHaveLength(1);
    errorSpy.mockRestore();
  });

  it("ignores a non-string conversation_id and creates a fresh conversation", async () => {
    const admin = mockAdmin();
    mockEmbedder();
    mockRetrieval([chunk("c1", "ctx", 0.8)]);
    mockProvider();

    // conversation_id is a number → parseBody drops it → no ownership lookup, fresh convo.
    const res = await queryHandler(queryRequest({ question: "hi", conversation_id: 123 }), ctx());
    await res.text();

    expect(admin.conversationFilters).toHaveLength(0); // no lookup attempted
    expect(admin.inserts.conversations).toHaveLength(1);
  });

  it("aligns retrieval-log similarity scores to the reranked citation order", async () => {
    const admin = mockAdmin();
    mockEmbedder();
    // Input order is NOT similarity order — buildPrompt reranks descending by similarity.
    mockRetrieval([chunk("low", "l", 0.2), chunk("high", "h", 0.95), chunk("mid", "m", 0.6)]);
    mockProvider();

    const res = await queryHandler(queryRequest({ question: "q" }), ctx());
    await res.text();

    // Citations + retrieval log follow the reranked order (high, mid, low), scores aligned.
    expect(JSON.parse(res.headers.get("X-Citations") ?? "null")).toEqual(["high", "mid", "low"]);
    expect(admin.inserts.retrieval_logs[0]).toMatchObject({
      chunk_ids: ["high", "mid", "low"],
      similarity_scores: [0.95, 0.6, 0.2],
    });
  });

  it("still returns 200 (best-effort) when a post-answer log insert fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = mockAdmin({ insertErrors: { retrieval_logs: { message: "log down" } } });
    mockEmbedder();
    mockRetrieval([chunk("c1", "ctx", 0.9)]);
    mockProvider("Answer [1].");

    const res = await queryHandler(queryRequest({ question: "What is alpha?" }), ctx());

    expect(res.status).toBe(200);
    // Draining the body drives onFinish → the (failing) post-answer writes.
    expect(await res.text()).toBe("Answer [1].");
    // The answer already streamed: the failed retrieval-log write is logged, never surfaced.
    expect(admin.inserts.retrieval_logs).toHaveLength(0);
    expect(admin.inserts.messages).toHaveLength(2); // user + assistant still recorded
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
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

  it("returns 500 (not a silent failure) when creating the conversation fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = mockAdmin({ insertErrors: { conversations: { message: "db down" } } });
    mockEmbedder();
    mockRetrieval([chunk("c1", "ctx", 0.9)]);

    const res = await queryHandler(queryRequest({ question: "What is alpha?" }), ctx());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "internal_error" });
    expect(errorSpy).toHaveBeenCalled();
    // Bailed before any downstream work: no user message, no embedding, no search.
    expect(admin.inserts.messages).toHaveLength(0);
    expect(createEmbedder).not.toHaveBeenCalled();
    expect(searchSimilarChunks).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("returns 500 when recording the user message fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = mockAdmin({ insertErrors: { messages: { message: "db down" } } });
    mockEmbedder();
    mockRetrieval([chunk("c1", "ctx", 0.9)]);

    const res = await queryHandler(queryRequest({ question: "What is alpha?" }), ctx());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "internal_error" });
    // Conversation was created; we bailed at the failed user-message write, before embedding.
    expect(admin.inserts.conversations).toHaveLength(1);
    expect(createEmbedder).not.toHaveBeenCalled();
    errorSpy.mockRestore();
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
