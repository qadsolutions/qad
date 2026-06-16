/**
 * Route handler helper for reading the verified tenant_id.
 *
 * The tenant middleware (src/middleware.ts) validates the JWT, confirms the
 * tenant is active, then sets `x-tenant-id` on the forwarded request. Route
 * handlers must call getTenantId() to obtain the tenant_id — they must never
 * source it from request body, query params, or path segments (SECURITY.md § 3).
 */

import { type NextRequest } from "next/server";

/**
 * Returns the verified `tenant_id` string for the current request.
 *
 * Throws if the header is absent, which indicates a misconfiguration:
 * a route handler is being called without the tenant middleware in the chain.
 * This is a programming error, not a user-facing error.
 */
export function getTenantId(request: NextRequest): string {
  const tenantId = request.headers.get("x-tenant-id");
  if (!tenantId) {
    throw new Error(
      "x-tenant-id header missing — all /api/* routes must run through the tenant middleware (src/middleware.ts)",
    );
  }
  return tenantId;
}
