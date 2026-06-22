/**
 * Service-role Supabase client for server-side privileged operations (issue #23).
 *
 * SECURITY (CLAUDE.md "Supabase key naming", SECURITY.md § 1): this client uses the
 * **service_role key**, which bypasses ALL Row Level Security. It must therefore:
 *   - run ONLY on the server (never imported into a Client Component / browser bundle),
 *   - read its key from `SUPABASE_SERVICE_ROLE_KEY` — a name WITHOUT a `NEXT_PUBLIC_`
 *     prefix, so it is never bundled into client JavaScript.
 *
 * It exists because the tenant-facing tables and the `documents` Storage bucket grant
 * `authenticated` SELECT only — every WRITE (document ingestion, chat persistence) is
 * service_role-only by design (see 20260617000002_create_core_content_tables.sql and
 * 20260618000001_storage_documents_bucket.sql). Since RLS is bypassed here, the caller
 * is responsible for scoping every write to the validated `tenant_id` from the request's
 * verified token — the same id `withTenant` extracts — never a value from the request body.
 */

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/** Read a required env var or fail loudly — a missing key is a deploy misconfiguration. */
function requireEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Create a service-role Supabase client. Stateless: no session is persisted and no
 * token is auto-refreshed, since this client authenticates with the static service
 * key rather than a user session. Reuse the returned client within a single request.
 */
export function createSupabaseAdminClient(): TypedSupabaseClient {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
