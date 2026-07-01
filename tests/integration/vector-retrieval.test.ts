/**
 * Integration tests for tenant-filtered vector similarity search (issue #28).
 *
 * Tests the `match_chunks` PostgreSQL function (20260629000001_match_chunks_ef_search.sql)
 * which is the M4 retrieval path. Covers the issue's acceptance criteria:
 *
 *   - Cosine similarity search using the HNSW index, results ordered by distance
 *   - Tenant-scoped results: RLS (authenticated path) + explicit WHERE (admin path)
 *   - Configurable top-k
 *   - Cross-tenant isolation: Tenant B cannot see Tenant A chunks under any path
 *
 * DB-layer tests run as qad_user (superuser / no RLS) to prove the explicit
 * tenant_id filter works independently. The asUser() tests simulate a Supabase
 * authenticated session to prove the RLS layer also isolates correctly.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";
import { unitish, vectorLiteral } from "../helpers/vector-test-utils";
import { createAsUser } from "../helpers/as-user";

const TENANT_A_ID = "aa000000-0000-0000-0000-000000000001";
const TENANT_B_ID = "bb000000-0000-0000-0000-000000000001";
const USER_A_ID = "aa000000-0000-0000-0000-000000000002";
const USER_B_ID = "bb000000-0000-0000-0000-000000000002";
const DOC_A_ID = "aa000000-0000-0000-0000-000000000003";
const DOC_B_ID = "bb000000-0000-0000-0000-000000000003";

// Tenant A: three chunks with orthogonal-ish vectors (hot at dimension 10, 20, 30)
const CHUNK_A1_ID = "aa000000-0000-0000-0000-000000000011";
const CHUNK_A2_ID = "aa000000-0000-0000-0000-000000000012";
const CHUNK_A3_ID = "aa000000-0000-0000-0000-000000000013";
// Tenant B: one chunk (hot at dimension 50) — never appears in Tenant A queries
const CHUNK_B1_ID = "bb000000-0000-0000-0000-000000000011";

let sql: ReturnType<typeof postgres>;
let asUser: ReturnType<typeof createAsUser>;

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  asUser = createAsUser(sql);
  await bootstrapTestDatabase(sql);

  await sql`
    INSERT INTO auth.users (id, email) VALUES
      (${USER_A_ID}, 'usera@retrieval.test'),
      (${USER_B_ID}, 'userb@retrieval.test')
  `;
  await sql`
    INSERT INTO public.tenants (id, name, slug, is_active) VALUES
      (${TENANT_A_ID}, 'Tenant A', 'tenant-a-ret', true),
      (${TENANT_B_ID}, 'Tenant B', 'tenant-b-ret', true)
  `;
  await sql`
    INSERT INTO public.users (id, tenant_id, email, role) VALUES
      (${USER_A_ID}, ${TENANT_A_ID}, 'usera@retrieval.test', 'admin'),
      (${USER_B_ID}, ${TENANT_B_ID}, 'userb@retrieval.test', 'admin')
  `;
  await sql`
    INSERT INTO public.documents (id, tenant_id, filename, file_type, storage_path, status) VALUES
      (${DOC_A_ID}, ${TENANT_A_ID}, 'a.txt', 'txt', ${TENANT_A_ID + "/" + DOC_A_ID + "/a.txt"}, 'ready'),
      (${DOC_B_ID}, ${TENANT_B_ID}, 'b.txt', 'txt', ${TENANT_B_ID + "/" + DOC_B_ID + "/b.txt"}, 'ready')
  `;
  await sql`
    INSERT INTO public.document_chunks (id, document_id, tenant_id, chunk_text, chunk_index, token_count) VALUES
      (${CHUNK_A1_ID}, ${DOC_A_ID}, ${TENANT_A_ID}, 'alpha chunk one',   0, 3),
      (${CHUNK_A2_ID}, ${DOC_A_ID}, ${TENANT_A_ID}, 'alpha chunk two',   1, 3),
      (${CHUNK_A3_ID}, ${DOC_A_ID}, ${TENANT_A_ID}, 'alpha chunk three', 2, 3),
      (${CHUNK_B1_ID}, ${DOC_B_ID}, ${TENANT_B_ID}, 'beta chunk one',    0, 3)
  `;
  // Tenant A: hot at dim 10, 20, 30. Tenant B: hot at dim 50.
  await sql`
    INSERT INTO public.embeddings (chunk_id, tenant_id, embedding, model_version) VALUES
      (${CHUNK_A1_ID}, ${TENANT_A_ID}, ${vectorLiteral(unitish(10))}::vector, 'nomic-embed-text'),
      (${CHUNK_A2_ID}, ${TENANT_A_ID}, ${vectorLiteral(unitish(20))}::vector, 'nomic-embed-text'),
      (${CHUNK_A3_ID}, ${TENANT_A_ID}, ${vectorLiteral(unitish(30))}::vector, 'nomic-embed-text'),
      (${CHUNK_B1_ID}, ${TENANT_B_ID}, ${vectorLiteral(unitish(50))}::vector, 'nomic-embed-text')
  `;
}, 30_000);

afterAll(async () => {
  await sql.end();
});

describe("match_chunks — nearest-neighbour ordering (#28 AC: cosine similarity via HNSW)", () => {
  it("returns the closest chunk first when querying near dimension 20", async () => {
    const query = vectorLiteral(unitish(20, 0.9));
    const rows = await sql<{ chunk_id: string; similarity: number }[]>`
      SELECT chunk_id, similarity
      FROM match_chunks(${query}, ${TENANT_A_ID}::uuid, 3)
    `;
    expect(rows).toHaveLength(3);
    // Chunk A2 is hot at dim 20 — must rank first
    expect(rows[0].chunk_id).toBe(CHUNK_A2_ID);
    // Top result is strictly better; lower ranks may tie (orthogonal vectors)
    expect(rows[0].similarity).toBeGreaterThan(rows[1].similarity);
    expect(rows[1].similarity).toBeGreaterThanOrEqual(rows[2].similarity);
  });

  it("returns chunk_text and document_id alongside the similarity score", async () => {
    const query = vectorLiteral(unitish(10));
    const rows = await sql<{
      chunk_id: string;
      document_id: string;
      chunk_text: string;
      similarity: number;
    }[]>`
      SELECT chunk_id, document_id, chunk_text, similarity
      FROM match_chunks(${query}, ${TENANT_A_ID}::uuid, 1)
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].chunk_id).toBe(CHUNK_A1_ID);
    expect(rows[0].document_id).toBe(DOC_A_ID);
    expect(rows[0].chunk_text).toBe("alpha chunk one");
    // A vector queried against itself has cosine distance ≈ 0, so similarity ≈ 1
    expect(rows[0].similarity).toBeCloseTo(1.0, 3);
  });
});

describe("match_chunks — top-k limit (#28 AC: configurable top-k)", () => {
  it("returns at most k rows when the tenant has more embeddings than k", async () => {
    const query = vectorLiteral(unitish(10, 0.5));
    const rows = await sql`SELECT * FROM match_chunks(${query}, ${TENANT_A_ID}::uuid, 2)`;
    expect(rows).toHaveLength(2);
  });

  it("returns all tenant rows when k exceeds the embedding count", async () => {
    const query = vectorLiteral(unitish(10));
    const rows = await sql`SELECT * FROM match_chunks(${query}, ${TENANT_A_ID}::uuid, 100)`;
    // Tenant A has exactly 3 embeddings
    expect(rows).toHaveLength(3);
  });

  it("uses k=5 when p_top_k is omitted (default parameter)", async () => {
    // Seed four extra chunks so Tenant A has 7 embeddings total, then check the
    // default k truncates at 5. Use chunk_index 10-13 to avoid collisions with
    // the shared fixtures (0-2).
    const extraChunks = [
      { id: "aa000000-0000-0000-0000-000000000021", dim: 40, idx: 10 },
      { id: "aa000000-0000-0000-0000-000000000022", dim: 41, idx: 11 },
      { id: "aa000000-0000-0000-0000-000000000023", dim: 42, idx: 12 },
      { id: "aa000000-0000-0000-0000-000000000024", dim: 43, idx: 13 },
    ];
    for (const c of extraChunks) {
      await sql`
        INSERT INTO public.document_chunks (id, document_id, tenant_id, chunk_text, chunk_index, token_count)
        VALUES (${c.id}, ${DOC_A_ID}, ${TENANT_A_ID}, ${"extra " + c.id}, ${c.idx}, 2)
        ON CONFLICT DO NOTHING
      `;
      await sql`
        INSERT INTO public.embeddings (chunk_id, tenant_id, embedding, model_version)
        VALUES (${c.id}, ${TENANT_A_ID}, ${vectorLiteral(unitish(c.dim))}::vector, 'nomic-embed-text')
        ON CONFLICT DO NOTHING
      `;
    }

    const query = vectorLiteral(unitish(10));
    const rows = await sql`SELECT * FROM match_chunks(${query}, ${TENANT_A_ID}::uuid)`;
    expect(rows).toHaveLength(5);
  });
});

describe("match_chunks — cross-tenant isolation (#28 AC: tenant_id filter)", () => {
  it("returns only Tenant A chunks when called with Tenant A's id (explicit filter)", async () => {
    const query = vectorLiteral(unitish(10));
    const rows = await sql<{ chunk_id: string }[]>`
      SELECT chunk_id FROM match_chunks(${query}, ${TENANT_A_ID}::uuid, 10)
    `;
    const ids = rows.map((r) => r.chunk_id);
    // Tenant B's chunk must never appear — even when Tenant A has extra chunks
    // seeded by earlier tests in this file.
    expect(ids).not.toContain(CHUNK_B1_ID);
  });

  it("Tenant B authenticated session sees only Tenant B chunks (RLS path)", async () => {
    // Query is near Tenant A's embeddings; RLS must prevent cross-tenant leakage.
    const query = vectorLiteral(unitish(10));
    const rows = await asUser(TENANT_B_ID, USER_B_ID, (tx) =>
      tx<{ chunk_id: string }[]>`
        SELECT chunk_id FROM match_chunks(${query}, ${TENANT_B_ID}::uuid, 10)
      `,
    );
    expect(rows.every((r) => r.chunk_id === CHUNK_B1_ID)).toBe(true);
    const ids = rows.map((r) => r.chunk_id);
    expect(ids).not.toContain(CHUNK_A1_ID);
    expect(ids).not.toContain(CHUNK_A2_ID);
    expect(ids).not.toContain(CHUNK_A3_ID);
  });

  it("returns zero rows when authenticated as Tenant B but p_tenant_id is Tenant A (RLS blocks)", async () => {
    // Even if the caller passes Tenant A's id, the JWT-scoped RLS on embeddings
    // restricts the row set to Tenant B — so the explicit filter finds nothing.
    const query = vectorLiteral(unitish(10));
    const rows = await asUser(TENANT_B_ID, USER_B_ID, (tx) =>
      tx`SELECT * FROM match_chunks(${query}, ${TENANT_A_ID}::uuid, 10)`,
    );
    expect(rows).toHaveLength(0);
  });
});
