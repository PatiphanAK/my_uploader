import { abortError, toUploadError, type UploadError } from "./errors";
import type { RetryOptions } from "./types";

export const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 15_000,
  factor: 2,
  jitter: true,
};

/**
 * Delay before the next attempt. `attempt` is the attempt that just failed
 * (1-based). Exponential with optional full jitter.
 */
export function backoffDelay(
  attempt: number,
  opts: RetryOptions,
  random: () => number = Math.random,
): number {
  const factor = opts.factor ?? 2;
  const capped = Math.min(opts.maxDelayMs, opts.baseDelayMs * factor ** (attempt - 1));
  return opts.jitter === false ? capped : Math.round(random() * capped);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface WithRetryOptions extends RetryOptions {
  signal?: AbortSignal;
  shouldRetry?: (err: UploadError, attempt: number) => boolean;
  onRetry?: (err: UploadError, attempt: number, delayMs: number) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

/** Run `fn` until it succeeds, a non-retryable error occurs, or attempts run out. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: WithRetryOptions,
): Promise<T> {
  const wait = opts.sleep ?? sleep;
  const shouldRetry = opts.shouldRetry ?? ((e) => e.retryable);
  for (let attempt = 1; ; attempt++) {
    if (opts.signal?.aborted) throw abortError();
    try {
      return await fn(attempt);
    } catch (raw) {
      const err = toUploadError(raw);
      if (err.code === "aborted" || opts.signal?.aborted) throw abortError();
      if (attempt >= opts.maxAttempts || !shouldRetry(err, attempt)) throw err;
      const delay = backoffDelay(attempt, opts, opts.random);
      opts.onRetry?.(err, attempt, delay);
      await wait(delay, opts.signal);
    }
  }
}
