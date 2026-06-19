import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { TransactionSql } from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";

/**
 * Integration tests for the pgvector embeddings table (#20),
 * 20260618000003_pgvector_embeddings.sql.
 *
 * Covers issue #20's acceptance criteria plus the proactively-added composite
 * tenant-consistency FK (#78 precedent):
 *
 *   embeddings_chunk_tenant_fk — (chunk_id, tenant_id) -> document_chunks (id, tenant_id)
 *
 * Schema-shape and FK tests run as the table owner (qad_user) so RLS does not
 * interfere — the point there is to prove the DB layer itself refuses a
 * tenant-mismatched row (the gap a service_role write bug could exploit, since
 * service_role bypasses RLS). The RLS test uses asUser() to simulate a real
 * Supabase authenticated session, mirroring tenant-isolation.test.ts.
 */

const EMBEDDING_DIM = 768;

const TENANT_A_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_B_ID = "22222222-2222-2222-2222-222222222222";
const USER_A_ID = "11111111-1111-1111-1111-000000000001";
const USER_B_ID = "22222222-2222-2222-2222-000000000001";
const DOC_A_ID = "11111111-1111-1111-1111-0000000000a1";
const DOC_B_ID = "22222222-2222-2222-2222-0000000000b1";

// Chunks under Tenant A — distinct chunk_index per row.
const CHUNK_A1_ID = "11111111-1111-1111-1111-00000000c001";
const CHUNK_A2_ID = "11111111-1111-1111-1111-00000000c002";
const CHUNK_A3_ID = "11111111-1111-1111-1111-00000000c003";
// One chunk under Tenant B (for the RLS cross-tenant test).
const CHUNK_B1_ID = "22222222-2222-2222-2222-00000000c001";

/**
 * Build a pgvector literal: '[v0,v1,...,v767]'. pgvector accepts this cast to
 * ::vector. The `postgres` driver does not natively serialize a JS number[] to
 * the vector wire format, so we pass the literal string and cast in SQL.
 */
function vectorLiteral(values: readonly number[]): string {
  return `[${values.join(",")}]`;
}

/** A 768-length vector that is `value` at index `hotIndex`, else 0. */
function unitish(hotIndex: number, value = 1): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  v[hotIndex] = value;
  return v;
}

let sql: ReturnType<typeof postgres>;

/**
 * Run `query` as a simulated Supabase authenticated session for the given
 * tenant/user — same SET LOCAL ROLE + request.jwt.claims pattern PostgREST
 * issues per request (see tenant-isolation.test.ts).
 */
async function asUser<T>(
  tenantId: string,
  userId: string,
  query: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE authenticated`;
    const claims = JSON.stringify({
      tenant_id: tenantId,
      sub: userId,
      role: "authenticated",
    });
    await tx`SELECT set_config('request.jwt.claims', ${claims}, true)`;
    return query(tx);
  }) as Promise<T>;
}

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await bootstrapTestDatabase(sql);

  await sql`
    INSERT INTO auth.users (id, email) VALUES
      (${USER_A_ID}, 'usera@embeddings.test'),
      (${USER_B_ID}, 'userb@embeddings.test')
  `;
  await sql`
    INSERT INTO public.tenants (id, name, slug, is_active) VALUES
      (${TENANT_A_ID}, 'Tenant A', 'tenant-a-emb', true),
      (${TENANT_B_ID}, 'Tenant B', 'tenant-b-emb', true)
  `;
  await sql`
    INSERT INTO public.users (id, tenant_id, email, role) VALUES
      (${USER_A_ID}, ${TENANT_A_ID}, 'usera@embeddings.test', 'admin'),
      (${USER_B_ID}, ${TENANT_B_ID}, 'userb@embeddings.test', 'admin')
  `;
  await sql`
    INSERT INTO public.documents (id, tenant_id, filename, file_type, storage_path, status) VALUES
      (${DOC_A_ID}, ${TENANT_A_ID}, 'a.pdf', 'pdf', ${TENANT_A_ID + "/" + DOC_A_ID + "/a.pdf"}, 'ready'),
      (${DOC_B_ID}, ${TENANT_B_ID}, 'b.pdf', 'pdf', ${TENANT_B_ID + "/" + DOC_B_ID + "/b.pdf"}, 'ready')
  `;
  await sql`
    INSERT INTO public.document_chunks (id, document_id, tenant_id, chunk_text, chunk_index, token_count) VALUES
      (${CHUNK_A1_ID}, ${DOC_A_ID}, ${TENANT_A_ID}, 'chunk a1', 0, 2),
      (${CHUNK_A2_ID}, ${DOC_A_ID}, ${TENANT_A_ID}, 'chunk a2', 1, 2),
      (${CHUNK_A3_ID}, ${DOC_A_ID}, ${TENANT_A_ID}, 'chunk a3', 2, 2),
      (${CHUNK_B1_ID}, ${DOC_B_ID}, ${TENANT_B_ID}, 'chunk b1', 0, 2)
  `;
}, 30_000);

afterAll(async () => {
  await sql.end();
});

describe("embeddings schema + dimensionality (#20)", () => {
  it("accepts an embedding whose tenant_id matches its chunk's tenant_id, with a real 768-length vector", async () => {
    const literal = vectorLiteral(unitish(0));
    const rows = await sql<{ chunk_id: string; tenant_id: string; dims: number }[]>`
      INSERT INTO public.embeddings (chunk_id, tenant_id, embedding, model_version)
      VALUES (${CHUNK_A1_ID}, ${TENANT_A_ID}, ${literal}::vector, 'nomic-embed-text')
      RETURNING chunk_id, tenant_id, vector_dims(embedding) AS dims
    `;
    expect(rows[0]).toMatchObject({
      chunk_id: CHUNK_A1_ID,
      tenant_id: TENANT_A_ID,
      dims: EMBEDDING_DIM,
    });
  });

  it("rejects a vector whose dimensionality is not 768", async () => {
    // 3-dim vector into a vector(768) column — pgvector raises a dimension error.
    await expect(
      sql`
        INSERT INTO public.embeddings (chunk_id, tenant_id, embedding, model_version)
        VALUES (${CHUNK_A2_ID}, ${TENANT_A_ID}, ${"[1,2,3]"}::vector, 'nomic-embed-text')
      `,
    ).rejects.toThrow(/expected 768 dimensions|different vector dimensions/i);
  });
});

describe("embeddings tenant-consistency FK (embeddings_chunk_tenant_fk)", () => {
  it("rejects an embedding whose tenant_id disagrees with its chunk's tenant_id", async () => {
    // CHUNK_A3_ID belongs to TENANT_A_ID; tenant_id here claims TENANT_B_ID — the
    // exact cross-tenant mismatch a buggy service_role bulk insert could produce.
    const literal = vectorLiteral(unitish(1));
    await expect(
      sql`
        INSERT INTO public.embeddings (chunk_id, tenant_id, embedding, model_version)
        VALUES (${CHUNK_A3_ID}, ${TENANT_B_ID}, ${literal}::vector, 'nomic-embed-text')
      `,
    ).rejects.toThrow(/violates foreign key constraint "embeddings_chunk_tenant_fk"/);
  });
});

describe("embeddings uniqueness (embeddings_chunk_model_uq)", () => {
  // The migration header asserts "one row per document_chunk". The composite
  // UNIQUE (chunk_id, model_version) makes that invariant real (#80 review):
  // a second row for the same chunk under the SAME model is rejected, but the
  // same chunk under a DIFFERENT model_version is allowed (re-embedding support).
  it("rejects a second embedding with the same chunk_id AND same model_version", async () => {
    // CHUNK_A1_ID already has a row from the first test, model_version
    // 'nomic-embed-text'. A second insert with that same pair is a true duplicate.
    const literal = vectorLiteral(unitish(2));
    await expect(
      sql`
        INSERT INTO public.embeddings (chunk_id, tenant_id, embedding, model_version)
        VALUES (${CHUNK_A1_ID}, ${TENANT_A_ID}, ${literal}::vector, 'nomic-embed-text')
      `,
    ).rejects.toThrow(/violates unique constraint "embeddings_chunk_model_uq"/);
  });

  it("accepts the same chunk_id under a DIFFERENT model_version (proves the composite key)", async () => {
    // Same chunk, newer model — the intentional re-embedding path. A bare
    // UNIQUE (chunk_id) would wrongly reject this; the composite key permits it.
    const literal = vectorLiteral(unitish(3));
    const rows = await sql<{ chunk_id: string; model_version: string }[]>`
      INSERT INTO public.embeddings (chunk_id, tenant_id, embedding, model_version)
      VALUES (${CHUNK_A1_ID}, ${TENANT_A_ID}, ${literal}::vector, 'nomic-embed-text-v2')
      RETURNING chunk_id, model_version
    `;
    expect(rows[0]).toMatchObject({
      chunk_id: CHUNK_A1_ID,
      model_version: "nomic-embed-text-v2",
    });
  });
});

describe("HNSW index (#20 acceptance criterion)", () => {
  it("creates an index on embeddings.embedding using the hnsw access method", async () => {
    // Prove the DDL produced a real hnsw index, not just that the migration ran.
    const rows = await sql<{ indexname: string }[]>`
      SELECT i.relname AS indexname
      FROM pg_class t
      JOIN pg_index ix ON ix.indrelid = t.oid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_am am ON am.oid = i.relam
      WHERE t.relname = 'embeddings'
        AND am.amname = 'hnsw'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexname).toBe("embeddings_embedding_hnsw_idx");
  });
});

describe("vector similarity search (the RAG retrieval path)", () => {
  it("orders nearest-neighbour by cosine distance, scoped to a tenant", async () => {
    // Seed three orthogonal-ish vectors under Tenant A: hot at index 10, 20, 30.
    await sql`
      INSERT INTO public.embeddings (chunk_id, tenant_id, embedding, model_version) VALUES
        (${CHUNK_A2_ID}, ${TENANT_A_ID}, ${vectorLiteral(unitish(20))}::vector, 'nomic-embed-text'),
        (${CHUNK_A3_ID}, ${TENANT_A_ID}, ${vectorLiteral(unitish(30))}::vector, 'nomic-embed-text')
    `;
    // CHUNK_A1_ID already has a vector hot at index 0 from the first test.

    // Query vector closest to the index-20 vector; that chunk must rank first.
    const query = vectorLiteral(unitish(20, 0.9));
    const rows = await sql<{ chunk_id: string }[]>`
      SELECT chunk_id
      FROM public.embeddings
      WHERE tenant_id = ${TENANT_A_ID}
      ORDER BY embedding <=> ${query}::vector
      LIMIT 3
    `;
    expect(rows).toHaveLength(3);
    expect(rows[0].chunk_id).toBe(CHUNK_A2_ID);
  });
});

describe("embeddings RLS (cross-tenant isolation)", () => {
  it("a Tenant B authenticated session cannot see Tenant A embeddings", async () => {
    // Tenant A has embeddings seeded above. Tenant B has none yet — seed one so
    // we can prove B sees its own row and zero of A's, not just an empty table.
    await sql`
      INSERT INTO public.embeddings (chunk_id, tenant_id, embedding, model_version)
      VALUES (${CHUNK_B1_ID}, ${TENANT_B_ID}, ${vectorLiteral(unitish(5))}::vector, 'nomic-embed-text')
    `;

    const bRows = await asUser(TENANT_B_ID, USER_B_ID, (tx) =>
      tx<{ tenant_id: string }[]>`SELECT tenant_id FROM public.embeddings`,
    );
    expect(bRows.length).toBeGreaterThan(0);
    expect(bRows.every((r) => r.tenant_id === TENANT_B_ID)).toBe(true);

    // Even an explicit filter for a known Tenant A chunk returns nothing.
    const leaked = await asUser(TENANT_B_ID, USER_B_ID, (tx) =>
      tx<{ id: string }[]>`
        SELECT id FROM public.embeddings WHERE chunk_id = ${CHUNK_A1_ID}
      `,
    );
    expect(leaked).toHaveLength(0);
  });

  it("a Tenant A authenticated session sees only Tenant A embeddings", async () => {
    const aRows = await asUser(TENANT_A_ID, USER_A_ID, (tx) =>
      tx<{ tenant_id: string }[]>`SELECT tenant_id FROM public.embeddings`,
    );
    expect(aRows.length).toBeGreaterThan(0);
    expect(aRows.every((r) => r.tenant_id === TENANT_A_ID)).toBe(true);
  });
});
