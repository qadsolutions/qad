import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { validateTenant, TenantValidationError } from "@/lib/auth/with-tenant";

/**
 * Live smoke test for the tenant-validation chain behind GET /api/me (issue #3).
 *
 * Unlike the unit tests (which mock Supabase), this runs the REAL chain against a
 * running local Supabase stack: the custom access-token hook minting `tenant_id`
 * into a real JWT, real `getClaims()` verification, and the real RLS-scoped
 * `is_active` query. It is the highest-fidelity check available before a login UI
 * (M5) exists to drive the cookie-based HTTP route directly.
 *
 * Skipped unless SUPABASE_SMOKE=1 — it needs the live stack and real keys, which
 * the unit CI job does not provide. Run locally with:
 *   SUPABASE_SMOKE=1 \
 *   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon jwt> \
 *   SUPABASE_SERVICE_ROLE_KEY=<service jwt> \
 *   pnpm vitest run tests/integration/me-smoke.test.ts
 */

const RUN = process.env.SUPABASE_SMOKE === "1";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const PASSWORD = "smoke-Pass-123456";

interface Seeded {
  tenantId: string;
  userId: string;
  email: string;
}

/** Service-role client — bypasses RLS, used only to seed and tear down. */
function adminClient(): SupabaseClient {
  return createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Seed one tenant + auth user + public.users row. Returns ids for sign-in/cleanup. */
async function seedTenant(admin: SupabaseClient, slug: string, isActive: boolean): Promise<Seeded> {
  const email = `${slug}@example.test`;

  const { data: tenant, error: tErr } = await admin
    .from("tenants")
    .insert({ name: slug, slug, is_active: isActive })
    .select("id")
    .single();
  if (tErr) throw tErr;

  const { data: created, error: uErr } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (uErr) throw uErr;
  const userId = created.user.id;

  const { error: pErr } = await admin
    .from("users")
    .insert({ id: userId, tenant_id: tenant.id, email, role: "admin" });
  if (pErr) throw pErr;

  return { tenantId: tenant.id, userId, email };
}

async function cleanup(admin: SupabaseClient, seeded: Seeded[]): Promise<void> {
  for (const s of seeded) {
    await admin.auth.admin.deleteUser(s.userId).catch(() => {});
    await admin.from("users").delete().eq("id", s.userId);
    await admin.from("tenants").delete().eq("id", s.tenantId);
  }
}

describe.skipIf(!RUN)("GET /api/me validation chain (live)", () => {
  const admin = RUN ? adminClient() : (null as unknown as SupabaseClient);
  const seeded: Seeded[] = [];
  let active: Seeded;
  let inactive: Seeded;

  beforeAll(async () => {
    active = await seedTenant(admin, "smoke-active", true);
    inactive = await seedTenant(admin, "smoke-inactive", false);
    seeded.push(active, inactive);
  }, 30_000);

  afterAll(async () => {
    await cleanup(admin, seeded);
  }, 30_000);

  it("mints tenant_id into the JWT and validates an active tenant", async () => {
    const client = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email: active.email, password: PASSWORD });
    expect(error).toBeNull();

    const ctx = await validateTenant(client);
    expect(ctx.tenantId).toBe(active.tenantId);
    expect(ctx.userId).toBe(active.userId);
    expect(ctx.role).toBe("admin");
  });

  it("rejects an inactive tenant with 403", async () => {
    const client = createClient(URL, ANON, { auth: { persistSession: false } });
    await client.auth.signInWithPassword({ email: inactive.email, password: PASSWORD });

    await expect(validateTenant(client)).rejects.toMatchObject({
      name: "TenantValidationError",
      status: 403,
    });
  });

  it("rejects an unauthenticated request with 401", async () => {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    await expect(validateTenant(anon)).rejects.toBeInstanceOf(TenantValidationError);
    await expect(validateTenant(anon)).rejects.toMatchObject({ status: 401 });
  });
});
