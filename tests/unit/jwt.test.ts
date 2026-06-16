import { describe, expect, it } from "vitest";
import {
  extractTenantContext,
  MissingTenantClaimError,
  type SupabaseJwtPayload,
} from "@/lib/auth/jwt";

/**
 * Unit tests for the JWT tenant-claim extraction primitive (issue #1).
 *
 * These assert the contract issue #3's middleware depends on: a valid token
 * yields a non-null `tenantId: string`, and a token missing the claim is rejected
 * rather than silently passing a null tenant into a DB query (SECURITY.md § 3).
 */

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_A = "11111111-1111-1111-1111-111111111111";

function payload(overrides: Partial<SupabaseJwtPayload> = {}): SupabaseJwtPayload {
  return {
    sub: USER_A,
    role: "authenticated",
    email: "a@tenant-a.com",
    tenant_id: TENANT_A,
    user_role: "admin",
    ...overrides,
  };
}

describe("extractTenantContext", () => {
  it("returns a validated tenant context from a well-formed token", () => {
    const ctx = extractTenantContext(payload());
    expect(ctx).toEqual({ userId: USER_A, tenantId: TENANT_A, role: "admin" });
  });

  it("defaults to the least-privileged role when user_role is absent or invalid", () => {
    expect(extractTenantContext(payload({ user_role: undefined })).role).toBe("user");
    expect(
      extractTenantContext(payload({ user_role: "superuser" as never })).role,
    ).toBe("user");
  });

  it("rejects a token with no tenant_id claim", () => {
    expect(() => extractTenantContext(payload({ tenant_id: undefined }))).toThrow(
      MissingTenantClaimError,
    );
  });

  it("rejects an empty-string tenant_id (never treated as valid)", () => {
    expect(() => extractTenantContext(payload({ tenant_id: "" }))).toThrow(
      MissingTenantClaimError,
    );
  });

  it("rejects a token with no sub (user id) claim", () => {
    expect(() => extractTenantContext(payload({ sub: "" }))).toThrow(
      MissingTenantClaimError,
    );
  });
});
