import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Load a gitignored `.env.test.local` (if present) into process.env before the config
 * is evaluated, so local runs can point DATABASE_URL at a local pgvector test DB
 * without per-run flags. Existing env vars always win, so CI — which sets these as real
 * env vars and ships no `.env.test.local` — is unaffected. Minimal KEY=VALUE parser:
 * no dotenv dependency, only simple surrounding-quote stripping (no interpolation).
 */
function loadTestEnvLocal(): void {
  let content: string;
  try {
    content = readFileSync(resolve(process.cwd(), ".env.test.local"), "utf-8");
  } catch {
    return; // No file (e.g. CI) — nothing to load.
  }
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue; // skip blanks and `#` comments
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadTestEnvLocal();

/**
 * Vitest configuration for QAD Solutions.
 *
 * Testing infrastructure starts at M1 (see CLAUDE.md "Testing"), not deferred to M8.
 * The `unit-tests` CI job runs `pnpm vitest run` on every PR. The cross-tenant
 * isolation integration test (tests/integration/tenant-isolation.test.ts) is the
 * M1 exit criterion.
 *
 * Test-time environment variables are defined under `test.env` below as safe
 * placeholders so the suite runs without a real .env. CI overrides these with its
 * own values (DATABASE_URL points at the pgvector service container). Never put a
 * real service_role key here — these are throwaway test values only.
 */
export default defineConfig({
  // Resolve the `@/*` path aliases from tsconfig.json natively (Vite 6+/Vitest 4).
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    globals: true,
    // Run test FILES one at a time. The integration suites share a single Postgres
    // database and each fully resets it (DROP SCHEMA public CASCADE + recreate roles)
    // in beforeAll. Two such files in parallel race on global objects — concurrent
    // CREATE ROLE throws a unique-violation, and one file's schema reset wipes the
    // other's seeded rows mid-run. Serializing files makes each bootstrap exclusive.
    // (Tests within a file already run sequentially by default.) Suites are small,
    // so the wall-clock cost is negligible.
    fileParallelism: false,
    include: ["tests/**/*.{test,spec}.ts", "src/**/*.{test,spec}.ts"],
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://qad_user:testpassword@localhost:5432/qad_test",
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "test-anon-placeholder",
      SUPABASE_SERVICE_ROLE_KEY:
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-placeholder",
      INFERENCE_PROVIDER: process.env.INFERENCE_PROVIDER ?? "mock",
    },
  },
});
