import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { conversationsHandler } from "@/app/api/conversations/route";
import { withTenant, type TenantHandlerContext } from "@/lib/auth/with-tenant";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/**
 * Unit tests for GET /api/conversations (issue #22). Mirrors documents-route.test.ts:
 *   - conversationsHandler direct: queries `conversations` filtered by the context
 *     tenant_id, shapes the response, and returns 500 on a query error.
 *   - withTenant-wrapped GET: auth (401) and tenant validation (403) gate the handler,
 *     and on success the filter uses the token's tenant_id, not the request.
 */

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_A = "11111111-1111-1111-1111-111111111111";

const fakeRequest = new Request("http://localhost/api/conversations") as unknown as NextRequest;

const SAMPLE_ROWS = [
  {
    id: "c0000000-0000-0000-0000-000000000001",
    title: "Pricing questions",
    created_at: "2026-06-18T10:00:00.000Z",
  },
  {
    id: "c0000000-0000-0000-0000-000000000002",
    title: null,
    created_at: "2026-06-17T09:00:00.000Z",
  },
];

/** Mock supporting only the route's own chain: from→select→eq→order (thenable). */
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

/** Fuller mock for the wrapped route — see documents-route.test.ts for the shape. */
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

describe("conversationsHandler (direct)", () => {
  it("returns the tenant's conversations, querying `conversations` filtered by the context tenant_id", async () => {
    const { client, from, eq } = mockDataClient({ data: SAMPLE_ROWS });

    const res = await conversationsHandler(fakeRequest, ctxFor(client));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ conversations: SAMPLE_ROWS });
    expect(from).toHaveBeenCalledWith("conversations");
    expect(eq).toHaveBeenCalledWith("tenant_id", TENANT_A);
  });

  it("returns 500 (not a silent empty list) when the query errors", async () => {
    const { client } = mockDataClient({ error: { message: "boom" } });

    const res = await conversationsHandler(fakeRequest, ctxFor(client));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "internal_error" });
  });
});

describe("GET /api/conversations (wrapped in withTenant)", () => {
  it("returns 401 and never runs the handler when the JWT is missing", async () => {
    const { client } = mockWrappedClient({ claims: null });
    const route = withTenant(conversationsHandler, { createClient: async () => client });

    const res = await route(fakeRequest);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "unauthorized" });
  });

  it("returns 403 when the token carries no tenant_id claim", async () => {
    const { client } = mockWrappedClient({
      claims: { sub: USER_A, role: "authenticated" },
    });
    const route = withTenant(conversationsHandler, { createClient: async () => client });

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
    const route = withTenant(conversationsHandler, { createClient: async () => client });

    const res = await route(fakeRequest);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ conversations: SAMPLE_ROWS });
    expect(eq).toHaveBeenCalledWith("tenant_id", TENANT_A);
  });
});
