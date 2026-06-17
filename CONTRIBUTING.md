# Contributing

## Protected CI Gates

### Tenant Isolation Test

`tests/integration/tenant-isolation.test.ts` is a **protected file**.

- Do not delete, rename, or move it.
- Do not skip or disable it in CI.
- CI is configured to fail hard if this file is absent (see `ci.yml`, issue #59).

**Why:** This test is the M1 exit criterion. It proves cross-tenant row-level security
holds on the `tenants` and `users` tables. Without it, the isolation guarantee is untested
and CI silently degrades to a pass. Any architectural change that would require removing
this test must be discussed in an issue before the file is touched.

If you need to extend the isolation test suite (e.g., for M2 tables), add new test files
alongside this one — do not replace it.
