import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { TransactionSql } from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";

/**
 * Cross-tenant isolation on the RAG retrieval path (issue #15).
 *
 * The protected M1 gate (tenant-isolation.test.ts) proves the isolation *mechanism*
 * (`JWT tenant_id` → RLS filter) on tenants/users. This file extends that proof onto
 * the documents → document_chunks → embeddings chain that the RAG query actually
 * traverses, and — critically — onto the pgvector similarity-search path:
 *
 *   the question a buggy retrieval query could get wrong is "did the vector search
 *   leak another tenant's chunk because the nearest neighbour happened to belong to
 *   them?" So Tenant B is seeded with the vector that is the GLOBAL nearest neighbour
 *   to the query, and we assert a Tenant A session's similarity search never returns
 *   it — RLS filters the ANN path just as it filters a plain SELECT.
 *
 * Same asUser() simulation as tenant-isolation.test.ts: SET LOCAL ROLE authenticated
 * + set request.jwt.claims, the two statements PostgREST issues per request. Seeding
 * runs as the table owner (qad_user) so RLS does not interfere with setup.
 */

const EMBEDDING_DIM = 768;

const TENANT_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000000";
const USER_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000000";

const DOC_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-0000000000d1";
const DOC_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-0000000000d1";

// Tenant A chunks.
const CHUNK_A1_ID = "aaaaaaaa-aaaa-aaaa-aaaa-00000000c001";
const CHUNK_A2_ID = "aaaaaaaa-aaaa-aaaa-aaaa-00000000c002";
// Tenant B chunk — its embedding is the global nearest neighbour to the query below.
const CHUNK_B1_ID = "bbbbbbbb-bbbb-bbbb-bbbb-00000000c001";

// The retrieval query vector and the hot dimension all the test vectors live on.
const HOT = 100;

let sql: ReturnType<typeof postgres>;

/** Build a pgvector literal '[v0,…,v767]' (the driver doesn't serialize number[]). */
function vectorLiteral(values: readonly number[]): string {
  return `[${values.join(",")}]`;
}

/** A 768-length vector that is `value` at index `hotIndex`, else 0. */
function unitish(hotIndex: number, value = 1): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  v[hotIndex] = value;
  return v;
}

/** Run `query` as a simulated Supabase authenticated session — see tenant-isolation.test.ts. */
async function asUser<T>(
  tenantId: string,
  userId: string,
  query: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE authenticated`;
    const claims = JSON.stringify({ tenant_id: tenantId, sub: userId, role: "authenticated" });
    await tx`SELECT set_config('request.jwt.claims', ${claims}, true)`;
    return query(tx);
  }) as Promise<T>;
}

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await bootstrapTestDatabase(sql);

  await sql`
    INSERT INTO auth.users (id, email) VALUES
      (${USER_A_ID}, 'usera@rag-iso.test'),
      (${USER_B_ID}, 'userb@rag-iso.test')
  `;
  await sql`
    INSERT INTO public.tenants (id, name, slug, is_active) VALUES
      (${TENANT_A_ID}, 'Tenant A', 'rag-iso-a', true),
      (${TENANT_B_ID}, 'Tenant B', 'rag-iso-b', true)
  `;
  await sql`
    INSERT INTO public.users (id, tenant_id, email, role) VALUES
      (${USER_A_ID}, ${TENANT_A_ID}, 'usera@rag-iso.test', 'admin'),
      (${USER_B_ID}, ${TENANT_B_ID}, 'userb@rag-iso.test', 'admin')
  `;
  await sql`
    INSERT INTO public.documents (id, tenant_id, filename, file_type, storage_path, status) VALUES
      (${DOC_A_ID}, ${TENANT_A_ID}, 'a.pdf', 'pdf', ${`${TENANT_A_ID}/${DOC_A_ID}/a.pdf`}, 'ready'),
      (${DOC_B_ID}, ${TENANT_B_ID}, 'b.pdf', 'pdf', ${`${TENANT_B_ID}/${DOC_B_ID}/b.pdf`}, 'ready')
  `;
  await sql`
    INSERT INTO public.document_chunks (id, document_id, tenant_id, chunk_text, chunk_index, token_count) VALUES
      (${CHUNK_A1_ID}, ${DOC_A_ID}, ${TENANT_A_ID}, 'tenant A chunk one', 0, 4),
      (${CHUNK_A2_ID}, ${DOC_A_ID}, ${TENANT_A_ID}, 'tenant A chunk two', 1, 4),
      (${CHUNK_B1_ID}, ${DOC_B_ID}, ${TENANT_B_ID}, 'tenant B SECRET chunk', 0, 4)
  `;
  // Vectors all sit on dimension HOT. B1 == the query (distance ~0, the global nearest);
  // A1 is close; A2 sits on a different dimension (far). So if a Tenant A retrieval ever
  // leaked across tenants, B1 would top the results — making a leak impossible to miss.
  await sql`
    INSERT INTO public.embeddings (chunk_id, tenant_id, embedding, model_version) VALUES
      (${CHUNK_A1_ID}, ${TENANT_A_ID}, ${vectorLiteral(unitish(HOT, 0.9))}::vector, 'nomic-embed-text'),
      (${CHUNK_A2_ID}, ${TENANT_A_ID}, ${vectorLiteral(unitish(HOT + 50))}::vector, 'nomic-embed-text'),
      (${CHUNK_B1_ID}, ${TENANT_B_ID}, ${vectorLiteral(unitish(HOT, 1.0))}::vector, 'nomic-embed-text')
  `;
}, 30_000);

afterAll(async () => {
  await sql.end();
});

describe("RAG retrieval path: cross-tenant isolation (#15)", () => {
  describe("document_chunks visibility", () => {
    it("Tenant A session sees only its own chunks (zero Tenant B chunks)", async () => {
      const rows = await asUser(TENANT_A_ID, USER_A_ID, (tx) =>
        tx<{ id: string; tenant_id: string }[]>`SELECT id, tenant_id FROM public.document_chunks`,
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenant_id === TENANT_A_ID)).toBe(true);
      expect(rows.some((r) => r.id === CHUNK_B1_ID)).toBe(false);
    });

    it("Tenant B session sees only its own chunks (zero Tenant A chunks)", async () => {
      const rows = await asUser(TENANT_B_ID, USER_B_ID, (tx) =>
        tx<{ id: string; tenant_id: string }[]>`SELECT id, tenant_id FROM public.document_chunks`,
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenant_id === TENANT_B_ID)).toBe(true);
      expect(rows.some((r) => r.id === CHUNK_A1_ID || r.id === CHUNK_A2_ID)).toBe(false);
    });

    it("Tenant A session gets zero rows even when explicitly filtering for a Tenant B chunk id", async () => {
      // RLS merges its USING predicate as an AND, so a targeted filter can't escape it.
      const rows = await asUser(TENANT_A_ID, USER_A_ID, (tx) =>
        tx<{ id: string }[]>`
          SELECT id FROM public.document_chunks WHERE id = ${CHUNK_B1_ID}
        `,
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe("pgvector similarity search (HNSW path) filtered by tenant_id", () => {
    // The query vector is identical to Tenant B's CHUNK_B1 embedding, so B1 is the
    // global nearest neighbour. The retrieval query is the real RAG shape: rank
    // embeddings by cosine distance and join to document_chunks for the chunk text.
    const queryVec = vectorLiteral(unitish(HOT, 1.0));

    it("Tenant A retrieval never returns Tenant B's nearest-neighbour chunk", async () => {
      const rows = await asUser(TENANT_A_ID, USER_A_ID, (tx) =>
        tx<{ chunk_id: string; tenant_id: string; chunk_text: string }[]>`
          SELECT e.chunk_id, e.tenant_id, dc.chunk_text
          FROM public.embeddings e
          JOIN public.document_chunks dc ON dc.id = e.chunk_id
          ORDER BY e.embedding <=> ${queryVec}::vector
          LIMIT 5
        `,
      );

      // Only Tenant A chunks come back, even though B1 is the true nearest neighbour.
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenant_id === TENANT_A_ID)).toBe(true);
      expect(rows.some((r) => r.chunk_id === CHUNK_B1_ID)).toBe(false);
      expect(rows.some((r) => r.chunk_text.includes("SECRET"))).toBe(false);
      // A's own nearest (A1, on the query's hot dimension) ranks first within A's view.
      expect(rows[0].chunk_id).toBe(CHUNK_A1_ID);
    });

    it("Tenant B retrieval returns its own chunk and zero Tenant A chunks", async () => {
      const rows = await asUser(TENANT_B_ID, USER_B_ID, (tx) =>
        tx<{ chunk_id: string; tenant_id: string }[]>`
          SELECT e.chunk_id, e.tenant_id
          FROM public.embeddings e
          JOIN public.document_chunks dc ON dc.id = e.chunk_id
          ORDER BY e.embedding <=> ${queryVec}::vector
          LIMIT 5
        `,
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenant_id === TENANT_B_ID)).toBe(true);
      expect(rows[0].chunk_id).toBe(CHUNK_B1_ID);
    });
  });
});
