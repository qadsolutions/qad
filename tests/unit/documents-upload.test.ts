import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { uploadHandler, POST } from "@/app/api/documents/upload/route";
import {
  MAX_FILE_SIZE_BYTES,
  resolveFileType,
  sanitizeFilename,
  validateUpload,
} from "@/lib/documents/validation";
import { withTenant, type TenantHandlerContext } from "@/lib/auth/with-tenant";
import type { TypedSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { triggerIngestion } from "@/lib/ingestion/trigger";

/**
 * Unit tests for POST /api/documents/upload (issue #23).
 *
 * Three layers:
 *   - pure validation helpers (validateUpload / resolveFileType / sanitizeFilename) —
 *     the rules, tested without a Request/File;
 *   - uploadHandler — exercised with a real multipart Request and a mocked service-role
 *     client, asserting the store → insert(processing) → trigger → 202 sequence, that
 *     writes are scoped to the *context* tenant_id, and the failure/cleanup paths;
 *   - the withTenant-wrapped POST — proves auth gates the handler (401 before any work).
 *
 * The admin client and the ingestion trigger are mocked so route logic is tested in
 * isolation; live Storage RLS isolation is proven by the integration suite.
 */

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/ingestion/trigger", () => ({ triggerIngestion: vi.fn() }));

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_A = "11111111-1111-1111-1111-111111111111";

function ctx(): TenantHandlerContext {
  return {
    tenant: { tenantId: TENANT_A, userId: USER_A, role: "admin" },
    // The upload handler writes via the admin client, not this RLS one — unused here.
    supabase: {} as TypedSupabaseClient,
  };
}

/** Mock service-role client supporting the handler's storage + table writes. */
function mockAdmin(opts: { uploadError?: unknown; insertError?: unknown } = {}) {
  // Typed via a generic so `upload.mock.calls[0]` is a [path, body, opts] tuple — the
  // implementation itself ignores its args.
  const upload = vi.fn<(path: string, body: unknown, opts?: unknown) => Promise<unknown>>(
    async () => ({
      data: opts.uploadError ? null : { path: "ok" },
      error: opts.uploadError ?? null,
    }),
  );
  const remove = vi.fn(async () => ({ data: [], error: null }));
  const insert = vi.fn(async () => ({ error: opts.insertError ?? null }));
  const storageFrom = vi.fn(() => ({ upload, remove }));
  const from = vi.fn(() => ({ insert }));
  const client = { storage: { from: storageFrom }, from } as unknown as TypedSupabaseClient;
  vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
  return { upload, remove, insert, storageFrom, from };
}

/** Build a real multipart POST request carrying one file field named "file". */
function uploadRequest(filename: string, content = "hello world", type = ""): NextRequest {
  const form = new FormData();
  form.set("file", new File([content], filename, type ? { type } : undefined));
  return new Request("http://localhost/api/documents/upload", {
    method: "POST",
    body: form,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validation helpers", () => {
  it("resolveFileType accepts the four allowed extensions, case-insensitively", () => {
    expect(resolveFileType("a.pdf")).toBe("pdf");
    expect(resolveFileType("REPORT.PDF")).toBe("pdf");
    expect(resolveFileType("a.docx")).toBe("docx");
    expect(resolveFileType("a.txt")).toBe("txt");
    expect(resolveFileType("a.md")).toBe("md");
  });

  it("resolveFileType rejects unknown or missing extensions", () => {
    expect(resolveFileType("a.exe")).toBeNull();
    expect(resolveFileType("noext")).toBeNull();
    expect(resolveFileType("trailingdot.")).toBeNull();
  });

  it("validateUpload maps each failure to the right status/code", () => {
    expect(validateUpload(null)).toMatchObject({ ok: false, status: 400, code: "missing_file" });
    expect(validateUpload({ name: "x.exe", size: 5 })).toMatchObject({
      ok: false,
      status: 415,
      code: "unsupported_file_type",
    });
    expect(validateUpload({ name: "x.pdf", size: 0 })).toMatchObject({
      ok: false,
      status: 400,
      code: "empty_file",
    });
    expect(validateUpload({ name: "x.pdf", size: MAX_FILE_SIZE_BYTES + 1 })).toMatchObject({
      ok: false,
      status: 413,
      code: "file_too_large",
    });
  });

  it("validateUpload accepts a valid file and returns its canonical type", () => {
    expect(validateUpload({ name: "Handbook.PDF", size: 1024 })).toEqual({
      ok: true,
      fileType: "pdf",
    });
  });

  it("sanitizeFilename strips directories, traversal, and unsafe chars", () => {
    expect(sanitizeFilename("plain.pdf")).toBe("plain.pdf");
    expect(sanitizeFilename("a/b/c.pdf")).toBe("c.pdf");
    expect(sanitizeFilename("..\\evil.pdf")).toBe("evil.pdf");
    expect(sanitizeFilename("we ird!.pdf")).toBe("we_ird_.pdf");
  });
});

describe("uploadHandler", () => {
  it("stores the file, creates a processing row, triggers ingestion, and returns 202", async () => {
    const admin = mockAdmin();

    const res = await uploadHandler(uploadRequest("sample.pdf"), ctx());

    expect(res.status).toBe(202);
    const body = (await res.json()) as { document_id: string; status: string };
    expect(body.status).toBe("processing");
    expect(body.document_id).toMatch(/^[0-9a-f-]{36}$/);

    // Stored under the context tenant's folder, with the document id as the middle segment.
    expect(admin.storageFrom).toHaveBeenCalledWith("documents");
    const [storagePath, fileArg] = admin.upload.mock.calls[0];
    expect(storagePath).toBe(`${TENANT_A}/${body.document_id}/sample.pdf`);
    expect(fileArg).toBeInstanceOf(File);

    // Row scoped to the validated token's tenant, status processing, path == stored path.
    expect(admin.from).toHaveBeenCalledWith("documents");
    expect(admin.insert).toHaveBeenCalledWith({
      id: body.document_id,
      tenant_id: TENANT_A,
      filename: "sample.pdf",
      file_type: "pdf",
      storage_path: storagePath,
      status: "processing",
    });

    expect(triggerIngestion).toHaveBeenCalledExactlyOnceWith(body.document_id);
    expect(admin.remove).not.toHaveBeenCalled();
  });

  it("rejects an unsupported type with 415 before any storage or db write", async () => {
    const admin = mockAdmin();

    const res = await uploadHandler(uploadRequest("malware.exe"), ctx());

    expect(res.status).toBe(415);
    await expect(res.json()).resolves.toMatchObject({ error: "unsupported_file_type" });
    expect(admin.upload).not.toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
    expect(triggerIngestion).not.toHaveBeenCalled();
  });

  it("returns 500 and does not create a row when storage fails", async () => {
    const admin = mockAdmin({ uploadError: { message: "boom" } });

    const res = await uploadHandler(uploadRequest("sample.pdf"), ctx());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "storage_error" });
    expect(admin.insert).not.toHaveBeenCalled();
    expect(admin.remove).not.toHaveBeenCalled();
    expect(triggerIngestion).not.toHaveBeenCalled();
  });

  it("cleans up the stored object and returns 500 when the row insert fails", async () => {
    const admin = mockAdmin({ insertError: { message: "constraint" } });

    const res = await uploadHandler(uploadRequest("sample.pdf"), ctx());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "internal_error" });
    // Orphan cleanup: the just-uploaded object is removed by its exact path.
    const [storagePath] = admin.upload.mock.calls[0];
    expect(admin.remove).toHaveBeenCalledExactlyOnceWith([storagePath]);
    expect(triggerIngestion).not.toHaveBeenCalled();
  });

  it("sanitizes the filename in the storage path but keeps it verbatim on the row", async () => {
    const admin = mockAdmin();

    const res = await uploadHandler(uploadRequest("../../etc/pas swd.pdf"), ctx());

    expect(res.status).toBe(202);
    const { document_id } = (await res.json()) as { document_id: string };
    const [storagePath] = admin.upload.mock.calls[0];
    expect(storagePath).toBe(`${TENANT_A}/${document_id}/pas_swd.pdf`);
    expect(admin.insert).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "../../etc/pas swd.pdf", storage_path: storagePath }),
    );
  });
});

describe("POST /api/documents/upload (wrapped in withTenant)", () => {
  it("returns 401 and never runs the handler when the JWT is missing", async () => {
    const admin = mockAdmin();
    const authClient = {
      auth: { getClaims: vi.fn(async () => ({ data: null, error: null })) },
      from: vi.fn(),
    } as unknown as TypedSupabaseClient;
    const route = withTenant(uploadHandler, { createClient: async () => authClient });

    const res = await route(uploadRequest("sample.pdf"));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "unauthorized" });
    expect(admin.upload).not.toHaveBeenCalled();
  });

  it("exports POST as the wrapped handler", () => {
    expect(typeof POST).toBe("function");
  });
});
