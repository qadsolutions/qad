# GIT_PROCEDURES.md

Version control rules for QAD Solutions. All contributors and Claude Code sessions
must follow these procedures. No exceptions.

---

## Branch Strategy

> **Current phase (pre-launch, M1–M8): single-tier flow.**
> No `dev` branch yet. Feature branches are cut from `main` and PR'd straight back
> into `main`. Branch protection on `main` (required CI + PR review) is the only gate
> needed while there are no live deployments and no clients.
>
> **`dev` is introduced at M9**, when the production Vercel deploy goes live and `main`
> must stay equal to "what the client sees." See [§ Introducing `dev` at M9](#introducing-dev-at-m9).

### Current flow (now)

```
main          ← protected. Cut feature branches from here; PR back into here.
feature/*     ← active development. One branch per GitHub Issue.
hotfix/*      ← same as feature/* for now (no separate prod line yet).
```

### Rules

- **`main` is always CI-green.** Do not merge a feature branch if CI is failing.
- Feature branches are created from `main`.
- Delete feature branches after merging.
- No direct commits to `main` — branch protection enforces this. Always PR.

### Branch naming

```
feature/m1-auth-tenant-model
feature/m2-database-schema
feature/m3-document-ingestion
hotfix/rls-policy-null-tenant
```

---

## Commit Conventions

All commits follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <short description>

[optional body]

[optional footer: closes #issue-number]
```

### Types

| Type | When to use |
|---|---|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `test` | Adding or updating tests |
| `refactor` | Code change with no behavior change |
| `chore` | Dependency updates, config changes, tooling |
| `docs` | Documentation only |
| `perf` | Performance improvement |
| `ci` | CI/CD workflow changes |

### Scopes

| Scope | Area |
|---|---|
| `auth` | Authentication and session management |
| `tenant` | Tenant isolation, middleware, RLS |
| `ingestion` | Document upload and processing pipeline |
| `rag` | RAG query engine, retrieval, prompt construction |
| `portal` | Client portal UI |
| `admin` | Admin dashboard UI |
| `platform` | Platform admin view |
| `db` | Database migrations and schema |
| `api` | API routes |
| `infra` | Docker, deployment, environment |

### Examples

```
feat(auth): add JWT tenant_id extraction middleware
fix(tenant): block cross-tenant chunk retrieval when tenant_id is null
test(tenant): add cross-tenant isolation integration test
chore(infra): remove broken api and client docker services
docs(db): add RLS policy explanation to schema migration comments
```

### Rules

- Subject line: 72 characters max. Imperative mood. No period at end.
- Every commit must pass `tsc --noEmit`.
- Never commit with `--no-verify`. Fix the hook, not the bypass.

---

## Pull Request Rules

### Before opening a PR

- [ ] CI is passing on the feature branch
- [ ] `tsc --noEmit` passes locally
- [ ] All new code paths have Vitest tests
- [ ] Cross-tenant isolation test still passes (if any DB or API code was touched)
- [ ] No `NEXT_PUBLIC_` prefix on `SUPABASE_SERVICE_ROLE_KEY` or any secret
- [ ] `.env.example` updated if new environment variables were added

### PR title

Follow the same Conventional Commits format:
```
feat(auth): implement Supabase JWT middleware with tenant_id extraction
```

### PR target

- **Now:** Feature branches → `main`. (Hotfixes are just feature branches until M9.)
- **From M9:** Feature → `dev` → `main`. See [§ Introducing `dev` at M9](#introducing-dev-at-m9).

### Merge strategy

- Feature → main: **Squash merge** (one clean commit per Issue)
- From M9, dev → main: **Merge commit** (preserves milestone history for the production timeline)

### Review

- Solo phase: CI must be green; you may self-merge your own PR.
- PRs that touch auth, tenant middleware, RLS policies, or the RAG engine require
  explicit verification that the cross-tenant isolation test is green.

---

## Forbidden Actions

| Action | Why |
|---|---|
| `git push --force` on `main` or `dev` | Destroys shared history |
| `git commit --no-verify` | Bypasses type safety and test hooks |
| `git rebase` on `dev` or `main` | Rewrites shared history |
| Committing `.env` or real credentials | Permanent exposure risk |
| Direct push to `main` or `dev` | Branch protection enforces this; never bypass |
| Merging with failing CI | Blocks all other developers |

---

## GitHub Milestones and Issues

Each build milestone (M1-M10) is a GitHub Milestone. All work is tracked as Issues.

### Issue labels

| Label | Meaning |
|---|---|
| `frontend` | UI and client-side code |
| `backend` | API routes and server logic |
| `database` | Schema, migrations, RLS policies |
| `infrastructure` | Docker, Vercel, Supabase config |
| `security` | Auth, tenant isolation, secret management |
| `testing` | Test coverage, Vitest, Playwright |
| `documentation` | Docs, comments, CLAUDE.md updates |
| `bug` | Something broken |
| `blocked` | Waiting on something external |

### Issue lifecycle

1. Create Issue, assign to milestone, add labels
2. Create feature branch from `main`: `feature/m1-auth-tenant-model`
3. Reference Issue in every commit: `closes #12`
4. Open PR targeting `main` when ready
5. PR merge auto-closes the Issue

---

## Introducing `dev` at M9

Once M9 (production deploy) lands, `main` becomes the live production line that
auto-deploys to Vercel. At that point, add the `dev` integration tier:

1. `git checkout main && git pull`
2. `git checkout -b dev && git push -u origin dev`
3. Add branch protection to `dev` (required CI, no force-push).
4. From then on: `feature/*` → `dev` → `main`. Feature PRs target `dev`;
   `dev` → `main` is the production release PR (merge commit, then tag).
5. Update the Branch Strategy and PR target sections above to the two-tier flow.

Until then, the single-tier `main` flow is the source of truth.

---

## Release Process

Releases correspond to significant milestone completions (M4, M7, M10).

```
1. dev → main PR: "release: M4 RAG query endpoint complete"
2. PR reviewed and approved, CI green
3. Merge commit to main → Vercel production deployment triggered automatically
4. Tag the release: git tag -a v0.4.0 -m "M4 complete — RAG query endpoint"
5. Push tag: git push origin v0.4.0
6. Update ROADMAP.md milestone status to complete
```

Version format: `v0.<milestone>.<patch>` — e.g., `v0.4.0` = M4 complete, `v0.4.1` = hotfix after M4.
