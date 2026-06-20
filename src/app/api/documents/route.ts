/**
 * GET /api/documents — list the calling tenant's documents (issue #22).
 *
 * Base read route wrapped in `withTenant` (SECURITY.md §3): the handler only runs
 * after the JWT is verified, a non-null `tenant_id` is present, and the tenant is
 * active. The tenant filter below sources its id from `tenant.tenantId` — the
 * validated token — never from the request body or query string.
 *
 * The `.eq("tenant_id", …)` is defence-in-depth: RLS already scopes the anon-key
 * client to the caller's tenant, but the explicit predicate keeps the route correct
 * even if a policy is ever loosened, and documents the intent at the call site.
 */

import { withTenant, type TenantRouteHandler } from "@/lib/auth/with-tenant";

/**
 * Exported for direct unit testing with a mocked context. The route export below
 * wraps it in `withTenant`; tests exercise both this handler (query shape, error
 * codes) and the wrapped form (auth/tenant validation).
 */
export const documentsHandler: TenantRouteHandler = async (_req, { tenant, supabase }) => {
  const { data, error } = await supabase
    .from("documents")
    .select("id, filename, file_type, status, version, created_at")
    .eq("tenant_id", tenant.tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    // Surface as a 500 rather than a silent empty list. Structured server-side
    // logging of the cause lands with the audit/monitoring sink in M9 (#75).
    return Response.json(
      { error: "internal_error", message: "Failed to load documents" },
      { status: 500 },
    );
  }

  return Response.json({ documents: data });
};

export const GET = withTenant(documentsHandler);
