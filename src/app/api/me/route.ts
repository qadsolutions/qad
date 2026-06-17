/**
 * GET /api/me — returns the caller's validated tenant context.
 *
 * The canonical example of the `withTenant` pattern (issue #3): the handler only
 * runs after the JWT is verified, a non-null `tenant_id` is present, and the
 * tenant is active. `tenant` comes from the verified token, never the request.
 */

import { withTenant } from "@/lib/auth/with-tenant";

export const GET = withTenant(async (_req, { tenant }) => {
  return Response.json({
    userId: tenant.userId,
    tenantId: tenant.tenantId,
    role: tenant.role,
  });
});
