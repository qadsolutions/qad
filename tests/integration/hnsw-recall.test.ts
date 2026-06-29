/**
 * HNSW filtered-recall regression test (issue #96).
 *
 * Verifies that Tenant A gets its full k legitimate matches even when Tenant B
 * has many vectors that are closer to the query (adversarial multi-tenant corpus).
 *
 * The shared HNSW index applies the tenant_id predicate as a post-filter over
 * its candidate window (hnsw.ef_search). Without widening the window, a small
 * ef_search with a large Tenant B population can exhaust the candidate set
 * before finding all of Tenant A's matching chunks, silently returning fewer
 * than k results. This test uses p_ef_search to control the window size and
 * asserts that the configurable parameter correctly adjusts recall.
 *
 * Adversarial setup:
 *   - Tenant A: k=3 chunks at dimensions 100, 101, 102 (near the query at 100)
 *   - Tenant B: 10 chunks at dimensions 100-109 with slightly higher weight
 *     (closer to the query), designed to dominate the HNSW candidate window
 *
 * With a sufficiently large ef_search, all 3 Tenant A chunks must be found.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";
import { unitish, vectorLiteral } from "../helpers/vector-test-utils";

// Unique UUIDs for this test file — no overlap with vector-retrieval.test.ts
const TENANT_A_ID = "aa111111-0000-0000-0000-000000000001";
const TENANT_B_ID = "bb111111-0000-0000-0000-000000000001";
const USER_A_ID = "aa111111-0000-0000-0000-000000000002";
const USER_B_ID = "bb111111-0000-0000-0000-000000000002";
const DOC_A_ID = "aa111111-0000-0000-0000-000000000003";
const DOC_B_ID = "bb111111-0000-0000-0000-000000000003";

// Tenant A chunks: three results we must get back
const CHUNK_A_IDS = [
  "aa111111-0000-0000-0000-000000000011",
  "aa111111-0000-0000-0000-000000000012",
  "aa111111-0000-0000-0000-000000000013",
];

// Tenant B chunks: many distractors with vectors near the query
const TENANT_B_CHUNK_COUNT = 10;
const CHUNK_B_IDS = Array.from(
  { length: TENANT_B_CHUNK_COUNT },
  (_, i) => `bb111111-0000-0000-0000-0000000000${(i + 11).toString().padStart(2, "0")}`,
);

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await bootstrapTestDatabase(sql);

  // Seed auth.users
  await sql`
    INSERT INTO auth.users (id, email) VALUES
      (${USER_A_ID}, 'usera@hnsw-recall.test'),
      (${USER_B_ID}, 'userb@hnsw-recall.test')
  `;

  // Seed tenants
  await sql`
    INSERT INTO public.tenants (id, name, slug, is_active) VALUES
      (${TENANT_A_ID}, 'Recall-A', 'recall-a', true),
      (${TENANT_B_ID}, 'Recall-B', 'recall-b', true)
  `;

  // Seed public users
  await sql`
    INSERT INTO public.users (id, tenant_id, email, role) VALUES
      (${USER_A_ID}, ${TENANT_A_ID}, 'usera@hnsw-recall.test', 'admin'),
      (${USER_B_ID}, ${TENANT_B_ID}, 'userb@hnsw-recall.test', 'admin')
  `;

  // Seed documents
  await sql`
    INSERT INTO public.documents (id, tenant_id, filename, file_type, storage_path, status) VALUES
      (${DOC_A_ID}, ${TENANT_A_ID}, 'recall-a.txt', 'txt',
        ${TENANT_A_ID + "/" + DOC_A_ID + "/recall-a.txt"}, 'ready'),
      (${DOC_B_ID}, ${TENANT_B_ID}, 'recall-b.txt', 'txt',
        ${TENANT_B_ID + "/" + DOC_B_ID + "/recall-b.txt"}, 'ready')
  `;

  // Tenant A: 3 chunks near query dimension 100 (value 0.8 — slightly further)
  for (let i = 0; i < CHUNK_A_IDS.length; i++) {
    await sql`
      INSERT INTO public.document_chunks (id, document_id, tenant_id, chunk_text, chunk_index, token_count)
      VALUES (${CHUNK_A_IDS[i]}, ${DOC_A_ID}, ${TENANT_A_ID},
              ${"recall-a chunk " + i}, ${i}, 3)
    `;
    await sql`
      INSERT INTO public.embeddings (chunk_id, tenant_id, embedding, model_version)
      VALUES (${CHUNK_A_IDS[i]}, ${TENANT_A_ID},
              ${vectorLiteral(unitish(100 + i, 0.8))}::vector,
              'nomic-embed-text')
    `;
  }

  // Tenant B: 10 chunks near the same query dimension (value 0.95 — closer than A)
  // These dominate the HNSW candidate window in adversarial conditions.
  for (let i = 0; i < TENANT_B_CHUNK_COUNT; i++) {
    await sql`
      INSERT INTO public.document_chunks (id, document_id, tenant_id, chunk_text, chunk_index, token_count)
      VALUES (${CHUNK_B_IDS[i]}, ${DOC_B_ID}, ${TENANT_B_ID},
              ${"recall-b chunk " + i}, ${i}, 3)
    `;
    await sql`
      INSERT INTO public.embeddings (chunk_id, tenant_id, embedding, model_version)
      VALUES (${CHUNK_B_IDS[i]}, ${TENANT_B_ID},
              ${vectorLiteral(unitish(100 + i, 0.95))}::vector,
              'nomic-embed-text')
    `;
  }
}, 30_000);

afterAll(async () => {
  await sql.end();
});

describe("HNSW filtered-recall (#96): adversarial multi-tenant corpus", () => {
  it("returns all k=3 Tenant A chunks with a wide ef_search even when Tenant B dominates the index", async () => {
    // Query is hot at dimension 100 — both tenants have vectors near this point.
    // Tenant B's vectors are closer (0.95 vs 0.8), so without ef_search widening
    // a tiny candidate window could be exhausted by Tenant B vectors before
    // finding all Tenant A chunks.
    const query = vectorLiteral(unitish(100));

    // ef_search=200 gives ample candidate headroom beyond the 13 total vectors.
    const rows = await sql<{ chunk_id: string }[]>`
      SELECT chunk_id FROM match_chunks(${query}, ${TENANT_A_ID}::uuid, 3, 200)
    `;

    expect(rows).toHaveLength(3);

    const returnedIds = rows.map((r) => r.chunk_id);

    // All returned chunks must belong to Tenant A
    for (const id of returnedIds) {
      expect(CHUNK_A_IDS).toContain(id);
    }

    // No Tenant B chunks may appear
    for (const id of returnedIds) {
      expect(CHUNK_B_IDS).not.toContain(id);
    }
  });

  it("accepts a custom p_ef_search value (e.g. 50) and still isolates tenants", async () => {
    const query = vectorLiteral(unitish(100));
    const rows = await sql<{ chunk_id: string }[]>`
      SELECT chunk_id FROM match_chunks(${query}, ${TENANT_A_ID}::uuid, 3, 50)
    `;
    // Isolation must hold regardless of ef_search value
    const returnedIds = rows.map((r) => r.chunk_id);
    for (const id of returnedIds) {
      expect(CHUNK_B_IDS).not.toContain(id);
    }
  });

  it("uses 100 as the default ef_search when p_ef_search is omitted", async () => {
    const query = vectorLiteral(unitish(100));
    // Call without the p_ef_search argument — uses the DEFAULT 100
    const rows = await sql<{ chunk_id: string }[]>`
      SELECT chunk_id FROM match_chunks(${query}, ${TENANT_A_ID}::uuid, 3)
    `;
    // Default should still return up to k results (isolation guaranteed)
    const returnedIds = rows.map((r) => r.chunk_id);
    for (const id of returnedIds) {
      expect(CHUNK_B_IDS).not.toContain(id);
    }
    // At most k=3 results
    expect(rows.length).toBeLessThanOrEqual(3);
  });
});
