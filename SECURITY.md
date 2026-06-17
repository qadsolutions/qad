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

Every API route that touches the database must:

1. Extract `tenant_id` from the authenticated JWT — never from query params or request body
2. Assert `tenant_id` is non-null before any DB query (TypeScript strict mode enforces this)
3. Use the anon key Supabase client (subject to RLS) for all tenant-scoped queries
4. Use service_role key only for platform admin operations

### Mandatory isolation test

File: `tests/integration/tenant-isolation.test.ts`

Must pass on every PR touching any API route, DB query, middleware, or RLS migration.

The isolation mechanism (`JWT tenant_id` claim → RLS filter) is identical across all
tenant-scoped tables, so the **M1** test proves it on the tables that exist in M1:
- Create Tenant A and Tenant B, each with its own user(s)
- Confirm Tenant A JWT returns zero Tenant B rows (querying `users`/`tenants` under RLS)
- Confirm Tenant B JWT returns zero Tenant A rows

This test is a **M1 exit criterion**. See CLAUDE.md.

In **M2**, once `documents` / `document_chunks` / `embeddings` exist, extend coverage to the
RAG retrieval path: assert Tenant A returns zero Tenant B **chunks** (tracked as a separate
M2 issue).

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

Minimum retention: 90 days.

---

## Reporting a Security Issue

Do not open a public GitHub Issue for security vulnerabilities.
Contact the repository owner directly with full details and reproduction steps.
