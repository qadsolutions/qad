/**
 * Retrieval-quality eval harness (issue #85).
 *
 * Re-runnable quality signal — NOT a CI correctness gate. It ingests the synthetic
 * golden set (real Ollama `nomic-embed-text` embeddings) into the pgvector test DB,
 * runs each golden question through the M4 retrieval path (`match_chunks`, tenant-
 * scoped), and reports recall@k / hit-rate@k against the expected chunks.
 *
 * SELF-SKIPS unless a real Ollama is reachable AND `DATABASE_URL` is set — so CI
 * (no Ollama service) skips it by design, exactly like `ollama-embedder-smoke.test.ts`.
 * Run it on demand with `pnpm eval:retrieval` (local Ollama + test DB up), or whenever
 * the embedding model or chunking changes, and compare against
 * `docs/retrieval-eval-baseline.md`.
 *
 * Synthetic data only (SECURITY.md §2) — the golden set is fabricated, so embedding it
 * under Ollama is safe.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";
import { vectorLiteral } from "../helpers/vector-test-utils";
import { createEmbedder } from "@/lib/ingestion/embedder";
import { getTopK } from "@/lib/rag/retrieval";
import { aggregate, formatReport, scoreQuestion, type ScoredQuestion } from "@/lib/rag/eval-metrics";
import {
  GOLDEN_CHUNKS,
  GOLDEN_DOCUMENTS,
  GOLDEN_QUESTIONS,
  GOLDEN_TENANT_ID,
  GOLDEN_USER_ID,
  NEGATIVE_QUESTIONS,
} from "./golden-set";

async function isOllamaReachable(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

const OLLAMA_URL = process.env.OLLAMA_EMBED_URL ?? "http://localhost:11434";
const shouldRun = Boolean(process.env.DATABASE_URL) && (await isOllamaReachable(OLLAMA_URL));

let sql: ReturnType<typeof postgres>;

describe.skipIf(!shouldRun)("retrieval-quality eval over the golden set (#85)", () => {
  beforeAll(async () => {
    sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    await bootstrapTestDatabase(sql);

    // Force the real Ollama embedder regardless of the suite's default mock provider.
    vi.stubEnv("INFERENCE_PROVIDER", "ollama");
    vi.stubEnv("OLLAMA_EMBED_URL", OLLAMA_URL);
    vi.stubEnv("EMBEDDING_MODEL", "nomic-embed-text");

    await sql`INSERT INTO auth.users (id, email) VALUES (${GOLDEN_USER_ID}, 'owner@northwind-eval.test')`;
    await sql`
      INSERT INTO public.tenants (id, name, slug, is_active)
      VALUES (${GOLDEN_TENANT_ID}, 'Northwind Home Services', 'northwind-eval', true)
    `;
    await sql`
      INSERT INTO public.users (id, tenant_id, email, role)
      VALUES (${GOLDEN_USER_ID}, ${GOLDEN_TENANT_ID}, 'owner@northwind-eval.test', 'admin')
    `;
    for (const doc of GOLDEN_DOCUMENTS) {
      await sql`
        INSERT INTO public.documents (id, tenant_id, filename, file_type, storage_path, status)
        VALUES (${doc.id}, ${GOLDEN_TENANT_ID}, ${doc.filename}, 'md',
                ${`${GOLDEN_TENANT_ID}/${doc.id}/${doc.filename}`}, 'ready')
      `;
    }
    for (const chunk of GOLDEN_CHUNKS) {
      await sql`
        INSERT INTO public.document_chunks (id, document_id, tenant_id, chunk_text, chunk_index, token_count)
        VALUES (${chunk.id}, ${chunk.documentId}, ${GOLDEN_TENANT_ID}, ${chunk.text}, ${chunk.chunkIndex}, 0)
      `;
    }

    // Embed all chunk texts with real Ollama, then bulk-insert the vectors.
    const embedder = createEmbedder();
    const vectors = await embedder.embed(GOLDEN_CHUNKS.map((c) => c.text));
    for (let i = 0; i < GOLDEN_CHUNKS.length; i++) {
      await sql`
        INSERT INTO public.embeddings (chunk_id, tenant_id, embedding, model_version)
        VALUES (${GOLDEN_CHUNKS[i].id}, ${GOLDEN_TENANT_ID},
                ${vectorLiteral(vectors[i])}::vector, ${embedder.modelVersion})
      `;
    }
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await sql?.end();
  });

  it(
    "scores recall@k / hit-rate@k for the golden questions and reports per-question hits",
    async () => {
      const k = getTopK();
      const embedder = createEmbedder();

      const questionVectors = await embedder.embed(GOLDEN_QUESTIONS.map((q) => q.question));
      const scored: ScoredQuestion[] = [];
      for (let i = 0; i < GOLDEN_QUESTIONS.length; i++) {
        const rows = await sql<{ chunk_id: string }[]>`
          SELECT chunk_id FROM match_chunks(${vectorLiteral(questionVectors[i])}, ${GOLDEN_TENANT_ID}::uuid, ${k})
        `;
        scored.push(
          scoreQuestion(
            GOLDEN_QUESTIONS[i],
            rows.map((r) => r.chunk_id),
            k,
          ),
        );
      }
      const report = aggregate(scored, k);

      // Report is the point of this eval — print it for the on-demand runner.
      console.log("\n" + formatReport(report));

      // Negative probes: report the top similarity so #97's threshold work can be tuned.
      for (const nq of NEGATIVE_QUESTIONS) {
        const [qv] = await embedder.embed([nq.question]);
        const rows = await sql<{ similarity: number }[]>`
          SELECT similarity FROM match_chunks(${vectorLiteral(qv)}, ${GOLDEN_TENANT_ID}::uuid, 1)
        `;
        console.log(
          `  [NEG ] ${nq.id}: top similarity ${(rows[0]?.similarity ?? 0).toFixed(3)} — "${nq.question}"`,
        );
      }

      // Sanity invariants (metrics well-formed) plus a gross-regression floor — the
      // precise baseline is recorded in docs/retrieval-eval-baseline.md, not asserted
      // strictly here (this is a quality signal, not a CI gate).
      expect(report.questionCount).toBe(GOLDEN_QUESTIONS.length);
      expect(report.meanRecallAtK).toBeGreaterThanOrEqual(0);
      expect(report.meanRecallAtK).toBeLessThanOrEqual(1);
      expect(report.hitRateAtK).toBeGreaterThanOrEqual(0.5);
    },
    60_000,
  );
});
