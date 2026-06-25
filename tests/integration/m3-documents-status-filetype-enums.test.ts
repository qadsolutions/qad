import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { bootstrapTestDatabase } from "../helpers/setup-test-db";

/**
 * Integration tests for the `document_status` / `document_file_type` Postgres enums
 * added in #92 (20260623000001_documents_status_filetype_enums.sql).
 *
 * Before #92, `documents.status` had only an inline CHECK (tested in
 * m2-content-tables-check.test.ts) and `documents.file_type` had no DB-level
 * constraint at all — both were plain `text`, so `supabase gen types` produced
 * `string` and the app layer re-declared the four-value invariants locally with no
 * compiler link to the schema. Moving both columns to named enums means typegen now
 * emits the literal unions directly (see src/lib/supabase/database.types.ts and the
 * derived types in src/lib/documents/validation.ts / src/lib/ingestion/ingest-document.ts).
 *
 * These tests prove the DB layer itself: each enum accepts exactly its four legal
 * values and rejects anything outside that set. Run as the table owner (qad_user),
 * so RLS does not interfere — same posture as m2-content-tables-check.test.ts.
 */

const TENANT_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await bootstrapTestDatabase(sql);

  await sql`
    INSERT INTO public.tenants (id, name, slug, is_active)
    VALUES (${TENANT_ID}, 'Tenant E', 'tenant-e', true)
  `;
}, 30_000);

afterAll(async () => {
  await sql.end();
});

describe("documents.status (document_status enum)", () => {
  it.each(["uploading", "processing", "ready", "error"])("accepts status %s", async (status) => {
    const rows = await sql<{ status: string }[]>`
      INSERT INTO public.documents (tenant_id, filename, file_type, storage_path, status)
      VALUES (${TENANT_ID}, 'ok.pdf', 'pdf', 'path/status-ok.pdf', ${status})
      RETURNING status
    `;
    expect(rows[0].status).toBe(status);
  });

  it("defaults to 'uploading' when status is omitted", async () => {
    const rows = await sql<{ status: string }[]>`
      INSERT INTO public.documents (tenant_id, filename, file_type, storage_path)
      VALUES (${TENANT_ID}, 'default.pdf', 'pdf', 'path/status-default.pdf')
      RETURNING status
    `;
    expect(rows[0].status).toBe("uploading");
  });

  it("rejects an out-of-range status", async () => {
    await expect(
      sql`
        INSERT INTO public.documents (tenant_id, filename, file_type, storage_path, status)
        VALUES (${TENANT_ID}, 'bad.pdf', 'pdf', 'path/status-bad.pdf', 'uplading')
      `,
    ).rejects.toThrow(/invalid input value for enum document_status/);
  });
});

describe("documents.file_type (document_file_type enum)", () => {
  it.each(["pdf", "docx", "txt", "md"])("accepts file_type %s", async (fileType) => {
    const rows = await sql<{ file_type: string }[]>`
      INSERT INTO public.documents (tenant_id, filename, file_type, storage_path, status)
      VALUES (${TENANT_ID}, ${"ok." + fileType}, ${fileType}, ${"path/filetype-ok-" + fileType}, 'ready')
      RETURNING file_type
    `;
    expect(rows[0].file_type).toBe(fileType);
  });

  it("rejects an out-of-range file_type", async () => {
    await expect(
      sql`
        INSERT INTO public.documents (tenant_id, filename, file_type, storage_path, status)
        VALUES (${TENANT_ID}, 'bad.xyz', 'xyz', 'path/filetype-bad.xyz', 'ready')
      `,
    ).rejects.toThrow(/invalid input value for enum document_file_type/);
  });
});
