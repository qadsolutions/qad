# SECURITY.md

Security rules for QAD Solutions. These are non-negotiable.
Violating these rules can expose client data and destroy the platform's core
privacy guarantee — the thing clients are paying for.

---

## 1. Supabase Key Rules

### The anon key — safe for client-side use

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

The `NEXT_PUBLIC_` prefix is correct and intentional for these two variables.
The anon key only has permissions granted by your RLS policies. Safe in browser code.

### The service_role key — server-side only

```
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

**This key bypasses ALL RLS policies.** It can read any tenant's data with no restriction.

Rules:
- NEVER add `NEXT_PUBLIC_` prefix
- NEVER import in any file that renders on the client
- ONLY use in `app/api/` route handlers
- NEVER commit to version control

If this key is exposed: rotate it immediately in the Supabase dashboard,
then audit all access logs for unauthorized reads.

---

## 2. Inference Provider Rules

### Groq API — synthetic data only

Groq routes LLM requests through Groq's cloud. This violates the privacy guarantee
for any real client data.

**Rule: Groq may only process synthetic or fabricated test data.**

Real data means: actual business documents, real customer queries, or any content
provided by or about a real client business.

### The production handover boundary

Switch from Groq to Ollama is triggered by one event:
**the first real client document is uploaded.**

Before: `INFERENCE_PROVIDER=groq` (dev/testing only)
After: `INFERENCE_PROVIDER=ollama` + `OLLAMA_BASE_URL=<cloudflare-tunnel>`

Verify before any demo or client onboarding:
```bash
grep INFERENCE_PROVIDER .env.local
# Must output "ollama" if any real data will be processed
```

---

## 3. Tenant Isolation Rules

### 3.1 Per-request isolation requirements

Every API route that touches the database must:

1. Extract `tenant_id` from the authenticated JWT — never from query params or request body
2. Assert `tenant_id` is non-null before any DB query (TypeScript strict mode enforces this)
3. Use the anon key Supabase client (subject to RLS) for all tenant-scoped queries
4. Use service_role key only for platform admin operations

**Carve-out:** rules 1–2 apply to tenant-scoped routes guarded by `withTenant`. Routes guarded by
`withPlatformAdmin` (§3.4) are **exempt from the `tenant_id` non-null assertion** — the
`platform_admin` actor has no tenant by design. They authorize on the `platform_admin` role claim
instead and must never fall through to the `withTenant` path.

### 3.2 Mandatory isolation test (M1)

File: `tests/integration/tenant-isolation.test.ts`

Must pass on every PR touching any API route, DB query, middleware, or RLS migration.

The isolation mechanism (`JWT tenant_id` claim → RLS filter) is identical across all
tenant-scoped tables, so the **M1** test proves it on the tables that exist in M1:
- Create Tenant A and Tenant B, each with its own user(s)
- Confirm Tenant A JWT returns zero Tenant B rows (querying `users`/`tenants` under RLS)
- Confirm Tenant B JWT returns zero Tenant A rows

This test is a **M1 exit criterion**. See CLAUDE.md.

### 3.3 Extending isolation coverage (M2+)

In **M2**, once `documents` / `document_chunks` / `embeddings` exist, extend coverage to the
RAG retrieval path: assert Tenant A returns zero Tenant B **chunks** (tracked as a separate
M2 issue).

### 3.4 Platform-admin access path

`platform_admin` is the operator role (us). It belongs to **no tenant** and must never reach
client data through RLS. Two API-layer guards enforce the separation:

- **`withTenant`** — the default guard for tenant-scoped routes (`app/api/**`). It extracts
  `tenant_id` from the JWT and **403s any request that has no `tenant_id` claim _or_ whose role
  is `platform_admin`**. A platform-admin token must never pass `withTenant`, even if a
  `tenant_id` were somehow present — the role check is explicit, not merely a side effect of the
  missing claim.
- **`withPlatformAdmin`** — the guard for platform routes (`app/api/platform/**`, M11). It asserts
  `role === 'platform_admin'`, then uses the **`service_role`** client (RLS-bypassing) for
  deliberate cross-tenant reads/writes.

Schema enforcement (issue #69, M2). `users.tenant_id` is nullable **only** for platform admins,
locked by two complementary CHECKs:

```sql
CHECK (role = 'platform_admin' OR tenant_id IS NOT NULL)   -- clients must have a tenant
CHECK (role <> 'platform_admin' OR tenant_id IS NULL)      -- platform admins must not
```

Together these make `tenant_id IS NULL` ⟺ `role = 'platform_admin'`, closing the confused-deputy
path where a `platform_admin` row carries a `tenant_id` and is mistakenly treated as a client of
that tenant.

**Role assignment is privileged.** The CHECKs above govern `tenant_id` nullability — they do **not**
restrict who can write `role = 'platform_admin'`. Therefore:

- **No API route using the anon-key client may accept or set `role = 'platform_admin'`.** User-facing
  creation/invite/update endpoints must reject that value (allow-list `user` / `admin` only).
- `platform_admin` rows may be created **only** via direct database access (the bootstrap path) or a
  `withPlatformAdmin`-guarded route — never through any signup, invite, or self-service flow.
- **Required integration test:** the anon-key client cannot create or escalate a row to
  `role = 'platform_admin'` (assert the write is rejected).

**Bootstrap.** The *first* `platform_admin` is a chicken-and-egg case (no platform admin exists yet to
authorize a guarded route), so it is seeded by **direct database access only** (migration/seed or
Supabase SQL console), and the procedure is documented in the runbook. Subsequent platform admins may
be created via a `withPlatformAdmin`-guarded route. No signup/invite flow may ever produce this role.

**Bounded write surface.** `withPlatformAdmin` routes use `service_role` (RLS-bypassing), so their
write scope must be **explicitly enumerated** — each permitted operation (e.g. tenant provisioning,
`plan_tier` change, deactivation) is its own purpose-built route with a typed payload. There is **no
generic cross-tenant write surface** via `service_role`; a compromised platform session must not be
able to overwrite arbitrary rows across all tenants.

**Blast radius / revocation.** A compromised `platform_admin` session is higher-impact than any tenant
session (cross-tenant reach via `service_role`). Incident response: immediately revoke the session and
rotate credentials (Supabase Auth admin sign-out / refresh-token revocation for that user, plus
`service_role` key rotation if key exposure is suspected — §1), then audit `audit_logs` for that
`user_id`. Document this as a standalone incident-response note in the M11 runbook.

---

## 4. Secret Management

- All secrets: `.env.local` (dev) or Vercel environment variables (prod)
- `.env.local` is gitignored — never commit it
- `.env.example` must be updated when any new variable is added
- `.env.example` contains only placeholder values — never real keys
- `N8N_ENCRYPTION_KEY` must never change after n8n's first run
- Rotate any key that was accidentally committed, even if immediately reverted

---

## 5. Audit Logging

Every query, document access, admin action, and model call must be logged to `audit_logs`
with: `user_id`, `tenant_id`, `action`, `resource_type`, `resource_id`, `ip_address`, `created_at`.

Audit logs are immutable — no UPDATE or DELETE on the `audit_logs` table for any role
except platform admin (delete only for data retention compliance, not edits).

**`tenant_id` is nullable** (Option A, decided 2026-06-17). It records the tenant an action
*affected*; a fleet-wide `platform_admin` action (no single tenant) stores `NULL`. `user_id` is
always set, so actor attribution is never lost. The tenant-admin audit view filters
`tenant_id = auth.jwt()->>'tenant_id'`, so NULL rows are invisible to clients (SQL three-valued
logic excludes them) and surface only via the `service_role` platform console (§3.4). Rationale:
keeps the isolation surface free of sentinel special-cases and reuses the `users.tenant_id`
nullability convention (issue #69).

The invariant **"NULL `tenant_id` ⇒ actor is `platform_admin`"** is enforced in the audit-logger
**write path**. Because that is a single code path with no DB-level backstop, it carries a
**required integration test**: *the audit-logger must reject any write where `tenant_id IS NULL` and
the actor is not `platform_admin`.* Any future writer (background job, new route) is covered by the
same logger; writing to `audit_logs` directly, bypassing it, is disallowed.

Minimum retention: 90 days. **Deletes are retention-scoped only:** the sole permitted `DELETE` on
`audit_logs` is the automated retention job removing rows older than the retention window — even
`platform_admin` may not delete arbitrary or in-window rows. There is no ad-hoc delete path.

---

## Reporting a Security Issue

Do not open a public GitHub Issue for security vulnerabilities.
Contact the repository owner directly with full details and reproduction steps.
