## What does this PR do?

<!-- One sentence summary -->

Closes #

## Type

- [ ] `feat` — new feature
- [ ] `fix` — bug fix
- [ ] `test` — tests only
- [ ] `refactor` — no behavior change
- [ ] `chore` — deps/config/tooling
- [ ] `docs` — documentation only
- [ ] `ci` — CI/CD workflow change

## Pre-merge checklist

- [ ] `tsc --noEmit` passes locally
- [ ] Vitest tests pass (`pnpm vitest run`)
- [ ] Tenant isolation test passes (if any API/DB code changed)
- [ ] No `NEXT_PUBLIC_` prefix on `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `.env.example` updated if new env vars were added
- [ ] CI is green on this branch

## Security check (skip if not applicable)

- [ ] No real client data used in tests — only synthetic data
- [ ] `INFERENCE_PROVIDER` is `ollama` if any real document flow was tested
- [ ] RLS policies enforced at query layer, not just app layer
