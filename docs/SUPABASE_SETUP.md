# Supabase Setup

How to set up Supabase for local development and connect it to the cloud project.

**Prereqs:** Node 20+, pnpm 11, Git, Docker Desktop (only for the local stack).
You should already have a `.env.local` with your Supabase keys (see env setup).

---

## 1. Install the CLI (as a dev dependency — version-locked for the team)

```bash
pnpm add -D supabase
```

Run every command as `pnpm supabase <cmd>`. (Global `npm i -g supabase` is unsupported.)

## 2. Log in (interactive — opens a browser)

```bash
pnpm supabase login
```

Tip: in Claude Code, run `! pnpm supabase login` to keep the output in-session.

## 3. Initialize the local Supabase folder

```bash
pnpm supabase init
```

Creates `supabase/config.toml` and `supabase/migrations/`. **Commit `config.toml`.**

## 4. Link the repo to your cloud project

```bash
pnpm supabase link --project-ref <your-ref>
```

- `<your-ref>` is in the dashboard URL and Settings → General (also saved in `supabase/.temp/project-ref`).
- Prompts for the **database password** (see note below).
- Stores project metadata in `supabase/.temp/` (gitignored).

### Database password (the common snag)

The DB password is **not** your Supabase account login and **not** the API keys — it's the
Postgres password, shown once at project creation. The CLI does **not** store it on disk; you
provide it per-connection.

- **Lost it?** Dashboard → Project Settings → Database → **Reset database password**. Copy it
  into a password manager. (Nothing uses the old one yet, so resetting is safe.)
- **Avoid re-typing** on every `db push`: `set` it as an env var (a secret — never commit):
  ```powershell
  $env:SUPABASE_DB_PASSWORD = "<your-db-password>"
  ```

## 5. Run the local stack (Postgres + pgvector + Auth + Studio in Docker)

```bash
pnpm supabase start     # boots it; prints local URLs + keys
pnpm supabase status    # show them again
pnpm supabase stop      # shut down
```

Local ports are 54321–54324 — no clash with 5433 / 11434 / 5678.

**No Docker?** Skip the local stack and test migrations against the cloud dev project with
`pnpm supabase db push` (coordinate so you don't reset each other's data).

## 6. Migration workflow

```bash
pnpm supabase migration new <name>   # new file in supabase/migrations/
# edit the SQL
pnpm supabase db reset               # re-apply ALL migrations to the LOCAL db
pnpm supabase db push                # apply NEW migrations to the CLOUD (needs DB password)
```

## Commit / don't-commit

| Commit | Don't commit |
|---|---|
| `supabase/config.toml` | `.env.local` |
| `supabase/migrations/*.sql` | `supabase/.temp`, `supabase/.branches` |
| | the DB password (any form) |

## 7. GitHub integration (optional — do it AFTER the first migration works)

Dashboard → Project → Settings → Integrations → GitHub → connect repo, set migrations dir to
`supabase`. Auto-applies migrations on merge; PR preview databases (Branching) may require the
Pro plan. Hold until the CLI workflow is proven.
