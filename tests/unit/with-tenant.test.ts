import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

import { withTenant } from "@/lib/auth/with-tenant";

/**
 * Unit tests for the tenant-validation middleware (issue #3).
 *
 * These assert the SECURITY.md § 3 contract at the HTTP boundary:
 *   - 401 when the JWT is missing/invalid
 *   - 403 when tenant_id is absent, or the tenant is inactive/missing
 *   - on success, the validated tenant_id (from the token, not the request) is
 *     handed to the handler, and the handler never runs on a validation failure.
 *
 * The Supabase client is mocked so the wrapper's decision logic is tested in
 * isolation — no network, no database. The live cross-tenant isolation test
 * (the M1 exit criterion) exercises the real DB separately.
 */

const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_B = "22222222-2222-2222-2222-222222222222";

interface MockOptions {
  claims?: Record<string, unknown> | null;
  claimsError?: { message: string } | null;
  tenantRow?: { is_active: boolean } | null;
  tenantError?: { message: string } | null;
}

/** Build a minimal Supabase client stub covering only what `validateTenant` calls. */
function mockSupabase(opts: MockOptions): SupabaseClient {
  return {
    auth: {
      getClaims: vi.fn(async () => ({
        data: opts.claims ? { claims: opts.claims } : null,
        error: opts.claimsError ?? null,
      })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: opts.tenantRow ?? null,
            error: opts.tenantError ?? null,
          })),
        })),
      })),
    })),
  } as unknown as SupabaseClient;
}

const fakeRequest = new Request("http://localhost/api/me") as unknown as NextRequest;

function validClaims() {
  return { sub: USER_B, role: "authenticated", tenant_id: TENANT_B, user_role: "admin" };
}

describe("withTenant", () => {
  it("returns 401 when the JWT is missing or invalid", async () => {
    const handler = vi.fn();
    const route = withTenant(handler, {
      createClient: async () => mockSupabase({ claims: null }),
    });

    const res = await route(fakeRequest);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "unauthorized" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when the token has no tenant_id claim", async () => {
    const handler = vi.fn();
    const route = withTenant(handler, {
      createClient: async () =>
        mockSupabase({ claims: { sub: USER_B, role: "authenticated" } }),
    });

    const res = await route(fakeRequest);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "forbidden" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when the tenant is inactive", async () => {
    const handler = vi.fn();
    const route = withTenant(handler, {
      createClient: async () =>
        mockSupabase({ claims: validClaims(), tenantRow: { is_active: false } }),
    });

    const res = await route(fakeRequest);

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when the tenant row is not found", async () => {
    const handler = vi.fn();
    const route = withTenant(handler, {
      createClient: async () =>
        mockSupabase({ claims: validClaims(), tenantRow: null }),
    });

    const res = await route(fakeRequest);

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes the validated tenant context to the handler on success", async () => {
    const handler = vi.fn(async (_req, { tenant }) =>
      Response.json({ tenantId: tenant.tenantId, role: tenant.role }),
    );
    const route = withTenant(handler, {
      createClient: async () =>
        mockSupabase({ claims: validClaims(), tenantRow: { is_active: true } }),
    });

    const res = await route(fakeRequest);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ tenantId: TENANT_B, role: "admin" });
    expect(handler).toHaveBeenCalledOnce();
    // tenant_id reached the handler from the token, not the request body.
    expect(handler.mock.calls[0][1].tenant.tenantId).toBe(TENANT_B);
  });
});
