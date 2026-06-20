/**
 * GET /api/conversations — list the calling tenant's conversations (issue #22).
 *
 * Base read route wrapped in `withTenant` (SECURITY.md §3): runs only after the JWT
 * is verified, a non-null `tenant_id` is present, and the tenant is active. The
 * tenant filter sources its id from `tenant.tenantId` (the validated token), never
 * from the request. `.eq("tenant_id", …)` is defence-in-depth alongside RLS.
 *
 * Scoped to the tenant, not the individual user: an `admin` reviewing their tenant's
 * activity is an in-tenant read, and RLS is tenant-scoped. Per-user filtering (the
 * Client Portal showing "my" threads) is a portal concern layered on top at M6.
 */

import { withTenant, type TenantRouteHandler } from "@/lib/auth/with-tenant";

/**
 * Exported for direct unit testing with a mocked context. The route export below
 * wraps it in `withTenant`; tests exercise both this handler (query shape, error
 * codes) and the wrapped form (auth/tenant validation).
 */
export const conversationsHandler: TenantRouteHandler = async (_req, { tenant, supabase }) => {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, created_at")
    .eq("tenant_id", tenant.tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    // Surface as a 500 rather than a silent empty list. Structured server-side
    // logging of the cause lands with the audit/monitoring sink in M9 (#75).
    return Response.json(
      { error: "internal_error", message: "Failed to load conversations" },
      { status: 500 },
    );
  }

  return Response.json({ conversations: data });
};

export const GET = withTenant(conversationsHandler);
