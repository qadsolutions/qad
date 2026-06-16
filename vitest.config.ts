import { defineConfig } from "vitest/config";

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
