/**
 * Request-scoped Supabase clients for server-side use (API routes, RSC).
 *
 * SECURITY (SECURITY.md § 1, § 3): the tenant-scoped client below uses the
 * **anon key**, so every query it runs is subject to Row Level Security — the
 * database itself enforces tenant isolation even if application code has a bug.
 * The service_role key (which bypasses ALL RLS) must never flow through this
 * path; it is reserved for platform-admin operations in a separate helper.
 */

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Read a required public env var or fail loudly at call time.
 *
 * A missing Supabase URL/key is a deployment misconfiguration, not a runtime
 * condition we should paper over — surfacing it as a thrown error is preferable
 * to silently constructing a client that 401s on every request.
 */
function requireEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Create an anon-key Supabase client bound to the current request's cookies.
 *
 * The client reads the user's session from cookies (set by Supabase Auth at
 * login) so `auth.getClaims()` can verify the JWT and queries run as the
 * authenticated user under RLS. Use this for ALL tenant-scoped data access.
 *
 * Next.js 16: `cookies()` is async, so this helper is async too.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // In a Route Handler the cookie store is writable, so Supabase can
          // rotate a refreshed session. In a Server Component it is read-only
          // and throws — that is expected and safe to ignore there.
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component without middleware refresh — ignore.
          }
        },
      },
    },
  );
}
