import { computeChecksum, defaultChecksumHeader } from "./checksum";
import { assertSafeUploadUrl, sanitizeStorageHeaders, type DestinationPolicy } from "./destination";
import { abortError, errorFromStorageResponse, UploadError } from "./errors";
import { withRetry, type WithRetryOptions } from "./retry";
import type {
  AdapterContext,
  CompletedPart,
  MultipartInstructions,
  PresignedPart,
  RetryOptions,
  UploadBackendAdapter,
  UploadTransport,
} from "./types";

export interface PartPlan {
  partNumber: number;
  start: number;
  end: number;
}

export function planParts(size: number, partSize: number): PartPlan[] {
  if (!Number.isFinite(partSize) || partSize <= 0) {
    throw new UploadError("protocol", `Invalid part size: ${partSize}`);
  }
  if (size === 0) return [{ partNumber: 1, start: 0, end: 0 }];
  const parts: PartPlan[] = [];
  for (let start = 0, n = 1; start < size; start += partSize, n++) {
    parts.push({ partNumber: n, start, end: Math.min(size, start + partSize) });
  }
  return parts;
}

const URL_EXPIRY_MARGIN_MS = 30_000;

function isExpiring(part: PresignedPart, now: number): boolean {
  if (!part.expiresAt) return false;
  const t = Date.parse(part.expiresAt);
  return Number.isFinite(t) && t - now < URL_EXPIRY_MARGIN_MS;
}

/**
 * Hands out presigned part URLs, batching signing calls when no checksum is
 * needed (checksums must be known before signing, so those parts are signed
 * one at a time, just before upload).
 */
export class PartUrlProvider {
  private cache = new Map<number, PresignedPart>();
  private pending = new Map<number, Promise<PresignedPart>>();

  constructor(
    private readonly adapter: UploadBackendAdapter,
    private readonly ctx: AdapterContext,
    private readonly uploadId: string,
    private readonly order: PartPlan[],
    private readonly batchSize: number,
    initial: PresignedPart[] = [],
    private readonly now: () => number = Date.now,
  ) {
    for (const p of initial) this.cache.set(p.partNumber, p);
  }

  invalidate(partNumber: number) {
    this.cache.delete(partNumber);
  }

  async get(part: PartPlan, checksum?: string): Promise<PresignedPart> {
    const size = part.end - part.start;
    if (checksum !== undefined) {
      this.cache.delete(part.partNumber);
      const res = await this.adapter.signParts(
        { uploadId: this.uploadId, parts: [{ partNumber: part.partNumber, size, checksum }] },
        this.ctx,
      );
      return pick(res.parts, part.partNumber);
    }

    const cached = this.cache.get(part.partNumber);
    if (cached && !isExpiring(cached, this.now())) return cached;

    const inflight = this.pending.get(part.partNumber);
    if (inflight) return inflight;

    // Sign this part plus the next unsigned parts in upload order.
    const batch: PartPlan[] = [part];
    const startIdx = this.order.findIndex((p) => p.partNumber === part.partNumber);
    for (let i = startIdx + 1; i < this.order.length && batch.length < this.batchSize; i++) {
      const p = this.order[i];
      const c = this.cache.get(p.partNumber);
      if (this.pending.has(p.partNumber) || (c && !isExpiring(c, this.now()))) continue;
      batch.push(p);
    }
    const request = this.adapter.signParts(
      {
        uploadId: this.uploadId,
        parts: batch.map((p) => ({ partNumber: p.partNumber, size: p.end - p.start })),
      },
      this.ctx,
    );
    for (const p of batch) {
      const derived = request.then((res) => {
        const signed = pick(res.parts, p.partNumber);
        this.cache.set(p.partNumber, signed);
        return signed;
      });
      this.pending.set(p.partNumber, derived);
      // Clear on settle; the catch also prevents unhandled rejections for
      // batch members nobody is awaiting yet.
      derived.then(
        () => this.pending.delete(p.partNumber),
        () => this.pending.delete(p.partNumber),
      );
    }
    return this.pending.get(part.partNumber)!;
  }
}

function pick(parts: PresignedPart[], partNumber: number): PresignedPart {
  const found = parts.find((p) => p.partNumber === partNumber);
  if (!found) throw new UploadError("protocol", `Backend did not sign part ${partNumber}`);
  return found;
}

export interface MultipartRunParams {
  file: Blob;
  uploadId: string;
  plan: MultipartInstructions;
  adapter: UploadBackendAdapter;
  ctx: AdapterContext;
  transport: UploadTransport;
  destination: DestinationPolicy;
  allowStorageAuthHeader?: boolean;
  concurrency: number;
  retry: RetryOptions;
  requestTimeoutMs?: number;
  signal: AbortSignal;
  /** Parts already uploaded. Mutated as parts complete, so the caller can resume. */
  completed: Map<number, CompletedPart>;
  onPartProgress?: (partNumber: number, loaded: number) => void;
  onPartReset?: (partNumber: number) => void;
  onPartComplete?: (part: CompletedPart, size: number) => void;
  onRetry?: WithRetryOptions["onRetry"];
  /** Test hooks. */
  sleep?: WithRetryOptions["sleep"];
  random?: () => number;
}

/**
 * Upload all outstanding parts with bounded concurrency. Memory use is bounded
 * by `concurrency` lazily-read `File.slice()` views (plus one part buffer per
 * worker while computing a SHA checksum).
 *
 * Resolves with all completed parts sorted by part number.
 */
export async function runMultipartUpload(params: MultipartRunParams): Promise<CompletedPart[]> {
  const { file, plan, signal, completed } = params;
  const parts = planParts(file.size, plan.partSize);
  if (plan.totalParts !== undefined && plan.totalParts !== parts.length) {
    throw new UploadError(
      "protocol",
      `Part count mismatch: backend expects ${plan.totalParts}, client computed ${parts.length}`,
    );
  }

  const outstanding = parts.filter((p) => !completed.has(p.partNumber));
  const internal = new AbortController();
  const onOuterAbort = () => internal.abort();
  if (signal.aborted) throw abortError();
  signal.addEventListener("abort", onOuterAbort, { once: true });

  const urls = new PartUrlProvider(
    params.adapter,
    { ...params.ctx, signal: internal.signal },
    params.uploadId,
    outstanding,
    Math.max(1, plan.partUrlBatchSize ?? 8),
    plan.parts,
  );
  const checksumHeader = plan.checksum
    ? (plan.checksum.header ?? defaultChecksumHeader(plan.checksum.algorithm))
    : undefined;

  const uploadPart = async (part: PartPlan) => {
    const size = part.end - part.start;
    const blob = file.slice(part.start, part.end);
    let checksum: string | undefined;

    await withRetry(
      async () => {
        if (plan.checksum && checksum === undefined) {
          checksum = await computeChecksum(blob, plan.checksum.algorithm);
        }
        const signed = await urls.get(part, checksum);
        const url = assertSafeUploadUrl(signed.url, params.destination).toString();
        const headers = sanitizeStorageHeaders(
          { ...signed.headers, ...(checksum && checksumHeader ? { [checksumHeader]: checksum } : {}) },
          { allowAuthorization: params.allowStorageAuthHeader },
        );
        try {
          const res = await params.transport.send({
            method: "PUT",
            url,
            headers,
            body: blob,
            signal: internal.signal,
            timeoutMs: params.requestTimeoutMs,
            onProgress: (loaded) => params.onPartProgress?.(part.partNumber, Math.min(loaded, size)),
          });
          if (res.status < 200 || res.status >= 300) throw errorFromStorageResponse(res.status, res.text);
          const etag = res.getHeader("ETag");
          if (!etag) {
            throw new UploadError(
              "protocol",
              "Storage response has no ETag header. Add ETag to the bucket's CORS ExposeHeaders.",
            );
          }
          const done: CompletedPart = { partNumber: part.partNumber, etag, size, ...(checksum ? { checksum } : {}) };
          completed.set(part.partNumber, done);
          params.onPartComplete?.(done, size);
        } catch (err) {
          params.onPartReset?.(part.partNumber);
          if (err instanceof UploadError && (err.code === "expired" || err.code === "forbidden")) {
            urls.invalidate(part.partNumber);
          }
          throw err;
        }
      },
      {
        ...params.retry,
        signal: internal.signal,
        onRetry: params.onRetry,
        sleep: params.sleep,
        random: params.random,
      },
    );
  };

  let next = 0;
  let firstError: unknown;
  const worker = async () => {
    while (!internal.signal.aborted) {
      const part = outstanding[next++];
      if (!part) return;
      try {
        await uploadPart(part);
      } catch (err) {
        if (firstError === undefined) firstError = err;
        internal.abort();
        return;
      }
    }
  };

  try {
    const workers = Math.max(1, Math.min(params.concurrency, outstanding.length));
    await Promise.all(Array.from({ length: workers }, worker));
  } finally {
    signal.removeEventListener("abort", onOuterAbort);
  }

  if (signal.aborted) throw abortError();
  if (firstError !== undefined) throw firstError;

  return [...completed.values()].sort((a, b) => a.partNumber - b.partNumber);
}
