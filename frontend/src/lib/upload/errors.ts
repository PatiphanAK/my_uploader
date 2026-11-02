export type UploadErrorCode =
  | "aborted"
  | "network"
  | "timeout"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "expired"
  | "too_large"
  | "unsupported_type"
  | "rate_limited"
  | "server"
  | "http"
  | "destination"
  | "checksum"
  | "protocol"
  | "validation"
  | "processing_failed"
  | "unknown";

export class UploadError extends Error {
  readonly code: UploadErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    code: UploadErrorCode,
    message: string,
    opts: { retryable?: boolean; status?: number; cause?: unknown } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "UploadError";
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.status = opts.status;
  }
}

export function abortError(): UploadError {
  return new UploadError("aborted", "Upload aborted");
}

export function isAbortError(err: unknown): boolean {
  if (err instanceof UploadError) return err.code === "aborted";
  return err instanceof Error && err.name === "AbortError";
}

export function toUploadError(err: unknown): UploadError {
  if (err instanceof UploadError) return err;
  if (isAbortError(err)) return abortError();
  if (err instanceof TypeError) {
    // fetch() rejects with TypeError on network/CORS failures.
    return new UploadError("network", "Network error — check connectivity and CORS settings", {
      retryable: true,
      cause: err,
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new UploadError("unknown", message, { cause: err });
}

/** Map an HTTP status from the upload API to an error. */
export function errorFromApiStatus(status: number, message?: string): UploadError {
  const msg = (fallback: string) => message || fallback;
  if (status === 401) return new UploadError("unauthorized", msg("Upload key rejected"), { status });
  if (status === 403) return new UploadError("forbidden", msg("Upload key lacks permission"), { status });
  if (status === 404) return new UploadError("not_found", msg("Upload not found"), { status });
  if (status === 408) return new UploadError("timeout", msg("Request timed out"), { status, retryable: true });
  if (status === 410) return new UploadError("expired", msg("Upload session expired"), { status });
  if (status === 413) return new UploadError("too_large", msg("File exceeds the allowed size"), { status });
  if (status === 415) return new UploadError("unsupported_type", msg("File type not allowed"), { status });
  if (status === 429) return new UploadError("rate_limited", msg("Too many requests"), { status, retryable: true });
  if (status >= 500) return new UploadError("server", msg(`Server error (${status})`), { status, retryable: true });
  return new UploadError("http", msg(`Request failed (${status})`), { status });
}

/**
 * Map a response from object storage to an error. Expired presigned URLs
 * (S3/MinIO/R2 return 403 with "Request has expired") are flagged so the
 * caller can re-sign and retry.
 */
export function errorFromStorageResponse(status: number, body: string): UploadError {
  if (status === 403 && /expired/i.test(body)) {
    return new UploadError("expired", "Presigned URL expired", { status, retryable: true });
  }
  if (status === 400 && /(BadDigest|InvalidDigest|checksum)/i.test(body)) {
    return new UploadError("checksum", "Storage rejected the checksum", { status, retryable: true });
  }
  if (status === 403) {
    return new UploadError("forbidden", "Storage rejected the request (403)", { status });
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new UploadError("server", `Storage error (${status})`, { status, retryable: true });
  }
  return new UploadError("http", `Storage request failed (${status})`, { status });
}
