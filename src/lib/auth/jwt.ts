/**
 * Extended Supabase JWT payload for QAD Solutions.
 *
 * Every access token is stamped with a custom `tenant_id` claim by the
 * `custom_access_token_hook` Postgres function (see
 * supabase/migrations/20260616000001_custom_access_token_hook.sql). That claim is
 * the foundation of all tenant isolation.
 *
 * SECURITY (see SECURITY.md § 3): `tenant_id` must be read from the JWT only —
 * never from query params or the request body — and asserted non-null before any
 * database query runs. `extractTenantContext` below is that assertion primitive;
 * the API middleware (issue #3) wraps it to produce 401/403 HTTP responses.
 */

/** Application role, mirrored from `public.users.role`. */
export type AppRole = "admin" | "user" | "platform_admin";

/**
 * Custom claims injected by the access token hook.
 *
 * `user_role` is intentionally NOT named `role`: Supabase already issues a
 * reserved top-level `role` claim holding the Postgres role (e.g. "authenticated")
 * that drives RLS. Overwriting it would break row-level security.
 */
export interface AppJwtClaims {
  /**
   * Tenant the caller belongs to. Optional `string` — NOT `string | null` —
   * deliberately: the access-token hook *omits* this claim entirely for a
   * tenant-less `platform_admin` (it never emits `null`). So at the JWT layer the
   * only states are "present string" or "absent (undefined)".
   *
   * This diverges on purpose from the DB column `users.tenant_id uuid | null`
   * (#69). When #22 generates DB types, do NOT "align" this claim type to
   * `string | null` — a `null` here would be a malformed token, and the absence
   * is what `extractTenantContext` keys on.
   */
  tenant_id?: string;
  user_role?: AppRole;
}

/**
 * The decoded access-token payload: the standard Supabase/JWT registered claims
 * plus our custom claims. Custom claims are optional here because a malformed or
 * pre-hook token may lack them — validation happens in `extractTenantContext`.
 */
export interface SupabaseJwtPayload extends AppJwtClaims {
  /** Subject — the authenticated user's id (auth.users.id). */
  sub: string;
  /** Postgres role used by RLS; "authenticated" for signed-in users. */
  role: string;
  email?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
}

/**
 * A validated tenant context. After `extractTenantContext` succeeds, `tenantId`
 * is guaranteed to be a non-null `string` (not `string | undefined`) — this is
 * the typed guarantee issue #3's middleware relies on (TS strict mode).
 */
export interface TenantContext {
  userId: string;
  tenantId: string;
  role: AppRole;
}

/** Thrown when a token is present but lacks a usable `tenant_id` claim. */
export class MissingTenantClaimError extends Error {
  constructor(message = "JWT is missing a non-null tenant_id claim") {
    super(message);
    this.name = "MissingTenantClaimError";
  }
}

const APP_ROLES: readonly AppRole[] = ["admin", "user", "platform_admin"];

function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

/**
 * Validate a decoded JWT payload and narrow it to a {@link TenantContext}.
 *
 * Throws {@link MissingTenantClaimError} if `sub` or a non-empty `tenant_id` is
 * absent. The returned `tenantId` is a guaranteed `string`. Callers must source
 * the payload from a verified token — this function does not verify signatures.
 */
export function extractTenantContext(payload: SupabaseJwtPayload): TenantContext {
  const tenantId = payload.tenant_id;
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new MissingTenantClaimError();
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new MissingTenantClaimError("JWT is missing a sub (user id) claim");
  }

  return {
    userId: payload.sub,
    tenantId,
    // Unknown / missing role falls back to "user" by design: it is the LEAST
    // privileged role (Client Portal, query-only), so an unrecognised claim
    // fails safe rather than escalating. Do not change this to throw or to
    // default to a higher role without revisiting the threat model.
    role: isAppRole(payload.user_role) ? payload.user_role : "user",
  };
}
