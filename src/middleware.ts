/**
 * Tenant validation middleware — runs on every /api/* request.
 *
 * Three-gate sequence:
 *   1. Bearer token present → 401 if missing
 *   2. JWT signature valid (Supabase Auth) → 401 if invalid/expired
 *   3. tenant_id claim present + tenant is active in DB → 403 if not
 *
 * On success, the verified `tenant_id` is forwarded as `x-tenant-id` so
 * route handlers can read it without touching the JWT again. Route handlers
 * must use getTenantId() from @/lib/tenant — never read tenant_id from the
 * request body or query params (SECURITY.md § 3).
 */

import { createClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import {
  extractTenantContext,
  MissingTenantClaimError,
  type SupabaseJwtPayload,
} from "@/lib/auth/jwt";

export async function middleware(request: NextRequest): Promise<NextResponse> {
  // Gate 1: Bearer token must be present.
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.slice(7);

  // Gate 2: Verify JWT signature via Supabase Auth.
  // Uses the anon-key client — no privileges, just token verification.
  const verifyClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { error: authError } = await verifyClient.auth.getUser(token);
  if (authError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Decode the verified payload and extract the validated tenant context.
  // extractTenantContext narrows tenantId to string (non-null) or throws.
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let tenantId: string;
  try {
    ({ tenantId } = extractTenantContext(payload));
  } catch (err) {
    if (err instanceof MissingTenantClaimError) {
      return NextResponse.json(
        { error: "Forbidden: tenant claim missing or invalid" },
        { status: 403 },
      );
    }
    throw err;
  }

  // Gate 3: Confirm the tenant is active.
  // Anon-key client with the user's own token → RLS restricts the query to
  // the user's own tenant row. If the tenant is inactive or absent, 0 rows
  // come back and we return 403 before any business logic runs.
  const tenantClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );

  const { data: tenant } = await tenantClient
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .eq("is_active", true)
    .maybeSingle();

  if (!tenant) {
    return NextResponse.json(
      { error: "Forbidden: tenant inactive or not found" },
      { status: 403 },
    );
  }

  // All gates passed. Forward the verified tenant_id to route handlers.
  const headers = new Headers(request.headers);
  headers.set("x-tenant-id", tenantId);
  return NextResponse.next({ request: { headers } });
}

/** Only intercept API routes — pages and static assets are unaffected. */
export const config = {
  matcher: "/api/:path*",
};

/**
 * Base64url-decode a JWT and return its payload as a typed object.
 * Returns null if the token is structurally invalid.
 *
 * The signature is NOT verified here — gate 2 handles that via Supabase Auth.
 * This decode is safe to run after a successful getUser() call.
 */
function decodeJwtPayload(token: string): SupabaseJwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const raw = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(raw)) as SupabaseJwtPayload;
  } catch {
    return null;
  }
}
