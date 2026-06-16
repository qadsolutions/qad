import { describe, expect, it } from "vitest";

/**
 * Smoke test — confirms the Vitest harness itself runs (issue #6).
 *
 * Beyond a trivial assertion, this verifies the test-time environment variables
 * configured in vitest.config.ts are visible to tests. Real suites (RAG pipeline,
 * tenant isolation) depend on these being set, so a failure here is an early signal
 * that the harness env wiring is broken.
 */
describe("vitest harness", () => {
  it("runs assertions", () => {
    expect(1 + 1).toBe(2);
  });

  it("exposes test-time environment variables", () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeTruthy();
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  });
});
