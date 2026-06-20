import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { documentsHandler } from "@/app/api/documents/route";
import { withTenant, type TenantHandlerContext } from "@/lib/auth/with-tenant";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/**
 * Unit tests for GET /api/documents (issue #22).
 *
 * Two layers, matching the route's two exports:
 *   - documentsHandler — tested directly with a mocked context: it must query the
 *     `documents` table filtered by the *context* tenant_id, shape the response, and
 *     return 500 (never a silent empty list) on a query error.
 *   - the withTenant-wrapped GET — tested via withTenant(handler, { createClient })
 *     to prove auth (401) and tenant validation (403) gate the handler, and that on
 *     success the tenant filter uses the id from the validated token, not the request.
 *
 * The Supabase client is mocked so route logic is tested in isolation (no DB). Live
 * cross-tenant isolation is proven separately by the integration suite.
 */

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_A = "11111111-1111-1111-1111-111111111111";

const fakeRequest = new Request("http://localhost/api/documents") as unknown as NextRequest;

const SAMPLE_ROWS = [
  {
    id: "d0000000-0000-0000-0000-000000000001",
    filename: "Handbook.pdf",
    file_type: "pdf",
    status: "ready",
    version: 1,
    created_at: "2026-06-18T10:00:00.000Z",
  },
];

/** Mock that supports only the route's own chain: from→select→eq→order (thenable). */
function mockDataClient(result: { data?: unknown; error?: unknown }) {
  const order = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }));
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const client = { from } as unknown as TypedSupabaseClient;
  return { client, from, select, eq, order };
}

function ctxFor(client: TypedSupabaseClient): TenantHandlerContext {
  return { tenant: { tenantId: TENANT_A, userId: USER_A, role: "admin" }, supabase: client };
}

/**
 * Fuller mock for the wrapped route: covers auth.getClaims, the tenants status probe
 * (validateTenant: select→eq→maybeSingle) and the documents read (select→eq→order),
 * which share the from→select→eq prefix and diverge at the terminal call.
 */
function mockWrappedClient(opts: {
  claims?: Record<string, unknown> | null;
  tenantRow?: { is_active: boolean } | null;
  rows?: unknown[];
}) {
  const order = vi.fn(async () => ({ data: opts.rows ?? [], error: null }));
  const maybeSingle = vi.fn(async () => ({ data: opts.tenantRow ?? null, error: null }));
  const eq = vi.fn(() => ({ order, maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const client = {
    auth: {
      getClaims: vi.fn(async () => ({
        data: opts.claims ? { claims: opts.claims } : null,
        error: null,
      })),
    },
    from,
  } as unknown as TypedSupabaseClient;
  return { client, from, eq };
}

function validClaims() {
  return { sub: USER_A, role: "authenticated", tenant_id: TENANT_A, user_role: "admin" };
}

describe("documentsHandler (direct)", () => {
  it("returns the tenant's documents, querying `documents` filtered by the context tenant_id", async () => {
    const { client, from, eq } = mockDataClient({ data: SAMPLE_ROWS });

    const res = await documentsHandler(fakeRequest, ctxFor(client));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ documents: SAMPLE_ROWS });
    expect(from).toHaveBeenCalledWith("documents");
    expect(eq).toHaveBeenCalledWith("tenant_id", TENANT_A);
  });

  it("returns 500 (not a silent empty list) when the query errors", async () => {
    const { client } = mockDataClient({ error: { message: "boom" } });

    const res = await documentsHandler(fakeRequest, ctxFor(client));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "internal_error" });
  });
});

describe("GET /api/documents (wrapped in withTenant)", () => {
  it("returns 401 and never runs the handler when the JWT is missing", async () => {
    const { client } = mockWrappedClient({ claims: null });
    const route = withTenant(documentsHandler, { createClient: async () => client });

    const res = await route(fakeRequest);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "unauthorized" });
  });

  it("returns 403 when the token carries no tenant_id claim", async () => {
    const { client } = mockWrappedClient({
      claims: { sub: USER_A, role: "authenticated" },
    });
    const route = withTenant(documentsHandler, { createClient: async () => client });

    const res = await route(fakeRequest);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "forbidden" });
  });

  it("on success filters by the tenant_id from the token, not the request", async () => {
    const { client, eq } = mockWrappedClient({
      claims: validClaims(),
      tenantRow: { is_active: true },
      rows: SAMPLE_ROWS,
    });
    const route = withTenant(documentsHandler, { createClient: async () => client });

    const res = await route(fakeRequest);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ documents: SAMPLE_ROWS });
    // The documents read filtered on the validated token's tenant.
    expect(eq).toHaveBeenCalledWith("tenant_id", TENANT_A);
  });
});
