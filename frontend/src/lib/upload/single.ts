import { computeChecksum, defaultChecksumHeader } from "./checksum";
import { assertSafeUploadUrl, sanitizeStorageHeaders, type DestinationPolicy } from "./destination";
import { errorFromStorageResponse } from "./errors";
import { withRetry, type WithRetryOptions } from "./retry";
import type {
  PresignedPostInstructions,
  PresignedPutInstructions,
  RetryOptions,
  UploadTransport,
} from "./types";

interface SingleRunParams {
  file: Blob;
  transport: UploadTransport;
  destination: DestinationPolicy;
  allowStorageAuthHeader?: boolean;
  retry: RetryOptions;
  requestTimeoutMs?: number;
  signal: AbortSignal;
  onProgress?: (loaded: number) => void;
  onRetry?: WithRetryOptions["onRetry"];
  sleep?: WithRetryOptions["sleep"];
}

export interface SingleResult {
  etag?: string;
  checksum?: string;
}

/** Single presigned PUT. The File is passed as the body; the browser streams it. */
export async function runPutUpload(
  plan: PresignedPutInstructions,
  params: SingleRunParams,
): Promise<SingleResult> {
  const url = assertSafeUploadUrl(plan.url, params.destination).toString();
  const checksum = plan.checksum ? await computeChecksum(params.file, plan.checksum.algorithm) : undefined;
  const headers = sanitizeStorageHeaders(
    {
      ...plan.headers,
      ...(checksum && plan.checksum
        ? { [plan.checksum.header ?? defaultChecksumHeader(plan.checksum.algorithm)]: checksum }
        : {}),
    },
    { allowAuthorization: params.allowStorageAuthHeader },
  );

  return withRetry(
    async () => {
      try {
        const res = await params.transport.send({
          method: "PUT",
          url,
          headers,
          body: params.file,
          signal: params.signal,
          timeoutMs: params.requestTimeoutMs,
          onProgress: params.onProgress,
        });
        if (res.status < 200 || res.status >= 300) throw errorFromStorageResponse(res.status, res.text);
        return { etag: res.getHeader("ETag") ?? undefined, checksum };
      } catch (err) {
        params.onProgress?.(0);
        throw err;
      }
    },
    {
      ...params.retry,
      signal: params.signal,
      onRetry: params.onRetry,
      sleep: params.sleep,
      // A single presigned URL cannot be re-signed here; let the session re-initiate.
      shouldRetry: (e) => e.retryable && e.code !== "expired",
    },
  );
}

/** Presigned POST (S3-style HTML form upload). Fields first, file last. */
export async function runPostUpload(
  plan: PresignedPostInstructions,
  params: SingleRunParams & { fileName: string },
): Promise<SingleResult> {
  const url = assertSafeUploadUrl(plan.url, params.destination).toString();

  return withRetry(
    async () => {
      const form = new FormData();
      for (const [k, v] of Object.entries(plan.fields ?? {})) form.append(k, v);
      form.append(plan.fileField ?? "file", params.file, params.fileName);
      try {
        const res = await params.transport.send({
          method: "POST",
          url,
          body: form,
          signal: params.signal,
          timeoutMs: params.requestTimeoutMs,
          // FormData adds boundary + field overhead; clamp to the file size.
          onProgress: (loaded) => params.onProgress?.(Math.min(loaded, params.file.size)),
        });
        if (res.status < 200 || res.status >= 300) throw errorFromStorageResponse(res.status, res.text);
        return { etag: res.getHeader("ETag") ?? undefined };
      } catch (err) {
        params.onProgress?.(0);
        throw err;
      }
    },
    {
      ...params.retry,
      signal: params.signal,
      onRetry: params.onRetry,
      sleep: params.sleep,
      shouldRetry: (e) => e.retryable && e.code !== "expired",
    },
  );
}
