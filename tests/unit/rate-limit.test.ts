import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkQueryRateLimit,
  checkUploadRateLimit,
  DEFAULT_QUERIES_PER_MINUTE,
  DEFAULT_UPLOADS_PER_DAY,
  getQueriesPerMinute,
  getUploadsPerDay,
} from "@/lib/rate-limit";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("config readers", () => {
  it("fall back to defaults when unset or empty", () => {
    vi.stubEnv("RATE_LIMIT_QUERIES_PER_MINUTE", "");
    vi.stubEnv("RATE_LIMIT_UPLOADS_PER_DAY", "");
    expect(getQueriesPerMinute()).toBe(DEFAULT_QUERIES_PER_MINUTE);
    expect(getUploadsPerDay()).toBe(DEFAULT_UPLOADS_PER_DAY);
  });

  it("read a positive-integer override", () => {
    vi.stubEnv("RATE_LIMIT_QUERIES_PER_MINUTE", "30");
    expect(getQueriesPerMinute()).toBe(30);
  });

  it.each(["0", "-5", "abc", "1.5"])("throw on invalid value %s", (value) => {
    vi.stubEnv("RATE_LIMIT_UPLOADS_PER_DAY", value);
    expect(() => getUploadsPerDay()).toThrow(/RATE_LIMIT_UPLOADS_PER_DAY/);
  });
});

describe("checkQueryRateLimit", () => {
  const TENANT = "11111111-1111-1111-1111-111111111111";
  const USER = "22222222-2222-2222-2222-222222222222";
  const RESET_AT = "2026-06-29T10:01:00.000Z";

  /** Mock admin whose `.rpc` resolves to one increment_rate_limit row (or an error). */
  function adminWithCount(currentCount: number | null, error: unknown = null): TypedSupabaseClient {
    const rpc = vi.fn(async () => ({
      data: currentCount === null ? [] : [{ current_count: currentCount, reset_at: RESET_AT }],
      error,
    }));
    return { rpc } as unknown as TypedSupabaseClient;
  }

  it("allows while the post-increment count is at or below the limit", async () => {
    vi.stubEnv("RATE_LIMIT_QUERIES_PER_MINUTE", "10");
    expect(await checkQueryRateLimit(adminWithCount(3), TENANT, USER)).toEqual({
      allowed: true,
      limit: 10,
      remaining: 7,
      resetAt: new Date(RESET_AT).getTime(),
    });
  });

  it("allows the exact limit-th request, leaving zero remaining (boundary)", async () => {
    vi.stubEnv("RATE_LIMIT_QUERIES_PER_MINUTE", "10");
    expect(await checkQueryRateLimit(adminWithCount(10), TENANT, USER)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
  });

  it("blocks once the count exceeds the limit (window refresh resets the count in SQL)", async () => {
    vi.stubEnv("RATE_LIMIT_QUERIES_PER_MINUTE", "10");
    expect(await checkQueryRateLimit(adminWithCount(11), TENANT, USER)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });

  it("passes the validated ids, query scope, and 60s window to increment_rate_limit", async () => {
    const admin = adminWithCount(1);
    await checkQueryRateLimit(admin, TENANT, USER);
    expect(admin.rpc).toHaveBeenCalledWith("increment_rate_limit", {
      p_tenant_id: TENANT,
      p_user_id: USER,
      p_scope: "query",
      p_window_seconds: 60,
    });
  });

  it("fails open (allowed) and logs when the increment errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await checkQueryRateLimit(adminWithCount(null, { message: "boom" }), TENANT, USER);
    expect(result.allowed).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("fails open (allowed) and logs when the increment returns no row", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await checkQueryRateLimit(adminWithCount(null), TENANT, USER);
    expect(result.allowed).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("checkUploadRateLimit", () => {
  function adminWithCount(count: number | null, error: unknown = null): TypedSupabaseClient {
    const gte = vi.fn(async () => ({ count, error }));
    const neq = vi.fn(() => ({ gte }));
    const eq = vi.fn(() => ({ neq }));
    const select = vi.fn(() => ({ eq }));
    return { from: vi.fn(() => ({ select })) } as unknown as TypedSupabaseClient;
  }

  it("excludes status: error rows so failed ingestions don't burn the daily quota", async () => {
    const gte = vi.fn(async () => ({ count: 0, error: null }));
    const neq = vi.fn(() => ({ gte }));
    const eq = vi.fn(() => ({ neq }));
    const select = vi.fn(() => ({ eq }));
    const admin = { from: vi.fn(() => ({ select })) } as unknown as TypedSupabaseClient;
    await checkUploadRateLimit(admin, "t1");
    expect(neq).toHaveBeenCalledWith("status", "error");
  });

  it("allows when uploads used is below the limit", async () => {
    vi.stubEnv("RATE_LIMIT_UPLOADS_PER_DAY", "5");
    expect(await checkUploadRateLimit(adminWithCount(4), "t1")).toMatchObject({
      allowed: true,
      limit: 5,
      used: 4,
    });
  });

  it("blocks when uploads used has reached the limit", async () => {
    vi.stubEnv("RATE_LIMIT_UPLOADS_PER_DAY", "5");
    expect((await checkUploadRateLimit(adminWithCount(5), "t1")).allowed).toBe(false);
  });

  it("fails open (allowed) and logs when the count query errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await checkUploadRateLimit(adminWithCount(null, { message: "boom" }), "t1");
    expect(result.allowed).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
