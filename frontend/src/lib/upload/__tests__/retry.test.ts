import { describe, expect, it, vi } from "vitest";
import { UploadError } from "../errors";
import { backoffDelay, sleep, withRetry } from "../retry";

const OPTS = { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 1000, factor: 2, jitter: false };

describe("backoffDelay", () => {
  it("grows exponentially and caps at maxDelayMs", () => {
    expect([1, 2, 3, 4, 5, 6].map((a) => backoffDelay(a, OPTS))).toEqual([100, 200, 400, 800, 1000, 1000]);
  });
  it("applies full jitter within [0, delay]", () => {
    const o = { ...OPTS, jitter: true };
    expect(backoffDelay(3, o, () => 0)).toBe(0);
    expect(backoffDelay(3, o, () => 0.5)).toBe(200);
    expect(backoffDelay(3, o, () => 0.999)).toBeLessThanOrEqual(400);
  });
});

describe("withRetry", () => {
  it("retries retryable errors with exponential delays, then succeeds", async () => {
    const delays: number[] = [];
    let n = 0;
    const result = await withRetry(
      async () => {
        if (++n < 3) throw new UploadError("server", "boom", { retryable: true });
        return "ok";
      },
      { ...OPTS, sleep: async (ms) => void delays.push(ms) },
    );
    expect(result).toBe("ok");
    expect(n).toBe(3);
    expect(delays).toEqual([100, 200]);
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn(async () => {
      throw new UploadError("unauthorized", "no");
    });
    await expect(withRetry(fn, { ...OPTS, sleep: async () => {} })).rejects.toMatchObject({ code: "unauthorized" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops after maxAttempts and surfaces the last error", async () => {
    const fn = vi.fn(async () => {
      throw new UploadError("network", "down", { retryable: true });
    });
    await expect(withRetry(fn, { ...OPTS, sleep: async () => {} })).rejects.toMatchObject({ code: "network" });
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("treats fetch TypeErrors as retryable network errors", async () => {
    let n = 0;
    await withRetry(
      async () => {
        if (++n === 1) throw new TypeError("Failed to fetch");
      },
      { ...OPTS, sleep: async () => {} },
    );
    expect(n).toBe(2);
  });

  it("cancels while waiting between attempts", async () => {
    const ctrl = new AbortController();
    const fn = vi.fn(async () => {
      throw new UploadError("server", "x", { retryable: true });
    });
    const p = withRetry(fn, { ...OPTS, baseDelayMs: 10_000, maxDelayMs: 10_000, signal: ctrl.signal });
    await new Promise((r) => setTimeout(r, 5));
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ code: "aborted" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("never retries an abort", async () => {
    const fn = vi.fn(async () => {
      throw new UploadError("aborted", "stop");
    });
    await expect(withRetry(fn, { ...OPTS, sleep: async () => {} })).rejects.toMatchObject({ code: "aborted" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("sleep", () => {
  it("rejects promptly when aborted", async () => {
    const ctrl = new AbortController();
    const p = sleep(60_000, ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ code: "aborted" });
  });
});
