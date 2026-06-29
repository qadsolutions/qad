/**
 * Per-tenant rate limiting (issue #62).
 *
 * Two cost vectors, two mechanisms — both enforced server-side inside the `withTenant`
 * path via the service-role admin client, both returning 429 when exceeded:
 *
 *   - Queries (RATE_LIMIT_QUERIES_PER_MINUTE): a durable, multi-instance-correct fixed
 *     window backed by the `rate_limit_counters` table, incremented atomically by the
 *     `increment_rate_limit` Postgres function — see {@link checkQueryRateLimit}. We use
 *     Postgres (not Redis/Upstash) deliberately: the limiter is partly throwaway (it
 *     exists to stay under Groq's free tier, gone at the M5 Ollama cutover), and at
 *     10–40 tenants there's no write contention to make Redis meaningfully better. All
 *     access goes through this one function, so a future swap to Redis — if volume ever
 *     demands it — is a one-function change. The `/api/query` route wiring lands with #30.
 *   - Uploads (RATE_LIMIT_UPLOADS_PER_DAY): a durable trailing-window count of the
 *     tenant's own `documents` rows. The document row IS the record, so this needs no
 *     extra table — see {@link checkUploadRateLimit}.
 *
 * Both limiters FAIL OPEN on a backend error (return allowed, log): a transient DB error
 * must not take the query/upload path down — the limit is a cost guard, not a security
 * boundary.
 */

import type { TypedSupabaseClient } from "@/lib/supabase/server";

export const DEFAULT_QUERIES_PER_MINUTE = 10;
export const DEFAULT_UPLOADS_PER_DAY = 50;

/** The query limiter's window, in seconds, passed to `increment_rate_limit`. */
const QUERY_WINDOW_SECONDS = 60;
/** `scope` value distinguishing the query counter from future limit kinds in the table. */
const QUERY_SCOPE = "query";

const DAY_MS = 86_400_000;

/** Read a positive-integer env var, falling back to `fallback`; throw on a bad value. */
function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

export function getQueriesPerMinute(): number {
  return readPositiveIntEnv("RATE_LIMIT_QUERIES_PER_MINUTE", DEFAULT_QUERIES_PER_MINUTE);
}

export function getUploadsPerDay(): number {
  return readPositiveIntEnv("RATE_LIMIT_UPLOADS_PER_DAY", DEFAULT_UPLOADS_PER_DAY);
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** Requests left in the current window (0 once exceeded). */
  remaining: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
}

/**
 * Per-tenant, per-user query rate limit (RATE_LIMIT_QUERIES_PER_MINUTE). Call inside the
 * `withTenant` path of `POST /api/query` (#30) with ids from the validated token (never
 * the request body), passing the service-role admin client. Each call atomically bumps
 * the tenant/user's counter for the current aligned 1-minute window via the
 * `increment_rate_limit` function and reports whether the post-increment count is within
 * the limit.
 *
 * Fails OPEN on a backend error (returns allowed, logs) — see the module header.
 */
export async function checkQueryRateLimit(
  admin: TypedSupabaseClient,
  tenantId: string,
  userId: string,
): Promise<RateLimitResult> {
  const limit = getQueriesPerMinute();

  const { data, error } = await admin.rpc("increment_rate_limit", {
    p_tenant_id: tenantId,
    p_user_id: userId,
    p_scope: QUERY_SCOPE,
    p_window_seconds: QUERY_WINDOW_SECONDS,
  });

  const row = data?.[0];
  if (error || !row) {
    if (error) {
      console.error(`query rate-limit increment failed for tenant ${tenantId}: ${error.message}`);
    } else {
      console.error(`query rate-limit increment returned no row for tenant ${tenantId}`);
    }
    // Fail open: don't block queries on a transient counter failure.
    return { allowed: true, limit, remaining: limit, resetAt: Date.now() + QUERY_WINDOW_SECONDS * 1000 };
  }

  const used = row.current_count;
  return {
    allowed: used <= limit,
    limit,
    remaining: Math.max(0, limit - used),
    resetAt: new Date(row.reset_at).getTime(),
  };
}

export interface UploadRateLimitResult {
  allowed: boolean;
  limit: number;
  /** Uploads already made in the trailing 24h window. */
  used: number;
}

/**
 * Per-tenant daily upload limit (RATE_LIMIT_UPLOADS_PER_DAY). Counts the tenant's
 * `documents` rows created in the trailing 24h via the admin client — durable and
 * correct across instances, no extra table. `tenantId` must come from the validated
 * token, never the request body.
 *
 * Fails OPEN on a counting error (returns allowed, logs) — see the module header.
 */
export async function checkUploadRateLimit(
  admin: TypedSupabaseClient,
  tenantId: string,
): Promise<UploadRateLimitResult> {
  const limit = getUploadsPerDay();
  const sinceIso = new Date(Date.now() - DAY_MS).toISOString();

  const { count, error } = await admin
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .gte("created_at", sinceIso);

  if (error) {
    console.error(`upload rate-limit count failed for tenant ${tenantId}: ${error.message}`);
    return { allowed: true, limit, used: 0 };
  }

  const used = count ?? 0;
  return { allowed: used < limit, limit, used };
}
