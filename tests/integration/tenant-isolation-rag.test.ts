import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";
import { unitish, vectorLiteral } from "../helpers/vector-test-utils";
import { createAsUser } from "../helpers/as-user";

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
 *   them?" So Tenant B is seeded with the vector that is the unique, unambiguous
 *   global nearest neighbour to the query (Tenant A's closest vector is deliberately
 *   tilted off-axis below so it can't tie with it — cosine distance depends only on
 *   direction, so two vectors on the same single axis are distance-0 from each other
 *   regardless of magnitude), and we assert a Tenant A session's similarity search
 *   never returns it — RLS filters the ANN path just as it filters a plain SELECT.
 *
 * Same asUser() simulation as tenant-isolation.test.ts: SET LOCAL ROLE authenticated
 * + set request.jwt.claims, the two statements PostgREST issues per request. Seeding
 * runs as the table owner (qad_user) so RLS does not interfere with setup.
 */

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
let asUser: ReturnType<typeof createAsUser>;

/**
 * A vector near the query but deliberately NOT a scalar multiple of it: same hot
 * dimension as `unitish(hotIndex, ...)`, plus a small component one dimension over.
 * Cosine distance depends only on direction, so a vector that's purely on the same
 * single axis as the query — any unitish(hotIndex, value) — is distance 0 from it
 * regardless of magnitude. Tilting off that axis breaks what would otherwise be an
 * unintended exact tie, so this is unambiguously farther from the query than a
 * same-axis vector, while still being far closer than an orthogonal one.
 */
function tiltedNear(hotIndex: number, value: number, tilt: number): number[] {
  const v = unitish(hotIndex, value);
  v[hotIndex + 1] = tilt;
  return v;
}

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  asUser = createAsUser(sql);
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
  // B1 sits exactly on the query's hot dimension (distance 0 — the unique global
  // nearest neighbour). A1 is tilted slightly off that axis (see tiltedNear() above)
  // so it is strictly farther than B1, not tied with it — a plain unitish(HOT, 0.9)
  // would be an unintended exact tie, since cosine distance ignores magnitude. A2
  // sits on a different dimension entirely (distance 1, far). So if a Tenant A
  // retrieval ever leaked across tenants, B1 would unambiguously top the results —
  // making a leak impossible to miss.
  await sql`
    INSERT INTO public.embeddings (chunk_id, tenant_id, embedding, model_version) VALUES
      (${CHUNK_A1_ID}, ${TENANT_A_ID}, ${vectorLiteral(tiltedNear(HOT, 0.9, 0.1))}::vector, 'nomic-embed-text'),
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
    // unique global nearest neighbour (Tenant A's nearest, A1, is tilted off-axis so
    // it can't tie with B1 — see the seeding comment above). The retrieval query is
    // the real RAG shape: rank embeddings by cosine distance and join to
    // document_chunks for the chunk text.
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
      // A's own nearest (A1, tilted near the query's hot dimension) ranks first within A's view.
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
