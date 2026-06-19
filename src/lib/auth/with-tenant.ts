/**
 * `withTenant` — tenant-validation middleware for API route handlers (issue #3).
 *
 * Wrap every handler in `src/app/api/` with this. It enforces SECURITY.md § 3 on
 * a single chokepoint so individual routes cannot forget to:
 *
 *   1. Verify the JWT                       → 401 if missing/invalid
 *   2. Reject `platform_admin` tokens       → 403 (no tenant; use withPlatformAdmin)
 *   3. Require a non-null `tenant_id` claim → 403 if absent
 *   4. Confirm the tenant is active         → 403 if inactive/not found
 *
 * The validated {@link TenantContext} and an RLS-scoped (anon-key) Supabase
 * client are passed *into* the handler, so `tenant_id` always originates from
 * the verified token — never from the request body or query params.
 *
 * Usage:
 *   export const GET = withTenant(async (req, { tenant, supabase }) => {
 *     const { data } = await supabase.from("documents").select();
 *     return Response.json(data);
 *   });
 */

import type { NextRequest } from "next/server";

import {
  extractTenantContext,
  MissingTenantClaimError,
  type SupabaseJwtPayload,
  type TenantContext,
} from "@/lib/auth/jwt";
import {
  createSupabaseServerClient,
  type TypedSupabaseClient,
} from "@/lib/supabase/server";

/** A validation failure mapped to an HTTP status. Thrown internally, never escapes. */
export class TenantValidationError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: "unauthorized" | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "TenantValidationError";
  }
}

/** What a wrapped handler receives after validation succeeds. */
export interface TenantHandlerContext {
  /** Validated tenant context — `tenantId` is a guaranteed non-null string. */
  tenant: TenantContext;
  /** RLS-scoped, schema-typed anon-key client; reuse it for all DB access in the handler. */
  supabase: TypedSupabaseClient;
}

export type TenantRouteHandler = (
  req: NextRequest,
  ctx: TenantHandlerContext,
) => Promise<Response> | Response;

export interface WithTenantOptions {
  /** Override the Supabase client factory (used by tests). Defaults to the real one. */
  createClient?: () => Promise<TypedSupabaseClient>;
}

/**
 * Run the three validation steps against an already-built client.
 *
 * Exported for direct unit testing. Throws {@link TenantValidationError} on any
 * failure; returns the validated context on success.
 */
export async function validateTenant(supabase: TypedSupabaseClient): Promise<TenantContext> {
  // Step 1: verify the JWT. getClaims() validates the token (signature/expiry);
  // a null payload or error means no usable authenticated session.
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    throw new TenantValidationError(401, "unauthorized", "Missing or invalid authentication token");
  }

  // Step 2: reject platform_admin explicitly. A platform_admin belongs to no tenant
  // (SECURITY.md §3.4) and must never pass a tenant-scoped route. Check the role claim
  // directly — not merely as a side effect of the missing tenant_id below — so a
  // platform_admin token that somehow carries a tenant_id (confused-deputy) is still
  // refused. Platform routes use the separate withPlatformAdmin guard + service_role.
  if ((data.claims as unknown as SupabaseJwtPayload).user_role === "platform_admin") {
    throw new TenantValidationError(
      403,
      "forbidden",
      "platform_admin tokens are not valid on tenant-scoped routes",
    );
  }

  // Step 3: require a non-null tenant_id. The token is valid here, so a missing
  // claim is an authorization failure (403), not an authentication one (401).
  let tenant: TenantContext;
  try {
    tenant = extractTenantContext(data.claims as unknown as SupabaseJwtPayload);
  } catch (err) {
    if (err instanceof MissingTenantClaimError) {
      throw new TenantValidationError(403, "forbidden", "Token is missing a tenant_id claim");
    }
    throw err;
  }

  // Step 4: confirm the tenant is active. RLS already scopes this select to the
  // caller's own tenant; the explicit .eq is defensive and self-documenting.
  const { data: row, error: queryError } = await supabase
    .from("tenants")
    .select("is_active")
    .eq("id", tenant.tenantId)
    .maybeSingle();

  if (queryError) {
    throw new TenantValidationError(403, "forbidden", "Unable to verify tenant status");
  }
  if (!row || row.is_active !== true) {
    throw new TenantValidationError(403, "forbidden", "Tenant is inactive or not found");
  }

  return tenant;
}

/**
 * Wrap an API route handler with tenant validation.
 *
 * Returns a handler that validates the request, then either responds 401/403 or
 * delegates to `handler` with the validated context. Unexpected (non-validation)
 * errors propagate so Next.js returns its standard 500.
 */
export function withTenant(
  handler: TenantRouteHandler,
  options: WithTenantOptions = {},
): (req: NextRequest) => Promise<Response> {
  const createClient = options.createClient ?? createSupabaseServerClient;

  return async (req: NextRequest): Promise<Response> => {
    const supabase = await createClient();

    let tenant: TenantContext;
    try {
      tenant = await validateTenant(supabase);
    } catch (err) {
      if (err instanceof TenantValidationError) {
        return Response.json({ error: err.code, message: err.message }, { status: err.status });
      }
      throw err;
    }

    return handler(req, { tenant, supabase });
  };
}
