/**
 * Universal Upload Protocol — shared types.
 *
 * These types describe the contract between this frontend and any backend
 * that issues upload keys. Backend-specific endpoint mappings live in
 * `./adapters`; everything here is transport- and provider-agnostic.
 *
 * See docs/backend-integration.md for the wire format.
 */

export type UploadStrategy = "post" | "put" | "multipart";

/** Checksum algorithms the client can compute. Values are base64-encoded. */
export type ChecksumAlgorithm = "CRC32" | "CRC32C" | "SHA1" | "SHA256";

export const SUPPORTED_STRATEGIES: readonly UploadStrategy[] = ["post", "put", "multipart"];
export const SUPPORTED_CHECKSUMS: readonly ChecksumAlgorithm[] = ["CRC32", "CRC32C", "SHA1", "SHA256"];

/* ------------------------------------------------------------------ */
/* Initiation                                                          */
/* ------------------------------------------------------------------ */

export interface FileDescriptor {
  name: string;
  size: number;
  /** MIME type as reported by the browser; may be an empty string. */
  type: string;
  lastModified: number;
}

/** What this client can do. The backend picks a strategy from this. */
export interface ClientCapabilities {
  strategies: UploadStrategy[];
  checksumAlgorithms: ChecksumAlgorithm[];
  resumable: boolean;
  /** Client-preferred multipart part size in bytes. The backend has the final say. */
  preferredPartSize: number;
  maxConcurrency: number;
}

export interface InitiateUploadRequest {
  file: FileDescriptor;
  client: ClientCapabilities;
  /** Set when the client wants to continue a previous multipart upload. */
  resumeUploadId?: string;
}

/** Restrictions resolved from the upload key; informational for the client. */
export interface UploadConstraints {
  maxFileSize?: number;
  /** MIME types; supports wildcards such as `image/*`. */
  allowedTypes?: string[];
  /** Extensions including the leading dot, e.g. `.pdf`. */
  allowedExtensions?: string[];
}

/** Tells the client to send a checksum with each storage request. */
export interface ChecksumRequirement {
  algorithm: ChecksumAlgorithm;
  /** Request header carrying the base64 checksum, e.g. `x-amz-checksum-sha256`. */
  header?: string;
}

export interface PresignedPostInstructions {
  strategy: "post";
  url: string;
  /** Form fields that must precede the file in the multipart/form-data body. */
  fields: Record<string, string>;
  /** Form field name for the file. Defaults to `file`. */
  fileField?: string;
  expiresAt?: string;
}

export interface PresignedPutInstructions {
  strategy: "put";
  url: string;
  headers?: Record<string, string>;
  checksum?: ChecksumRequirement;
  expiresAt?: string;
}

export interface MultipartInstructions {
  strategy: "multipart";
  partSize: number;
  /** If present, the client verifies its own part count against it. */
  totalParts?: number;
  /** Optional pre-signed URLs for the first parts. */
  parts?: PresignedPart[];
  /** How many part URLs to request per signing call (no-checksum mode). Default 8. */
  partUrlBatchSize?: number;
  checksum?: ChecksumRequirement;
  /** The backend can list completed parts so the upload can continue after a reload. */
  resumable?: boolean;
  /** Parts the backend already holds (when resuming). */
  completedParts?: CompletedPart[];
  expiresAt?: string;
}

export type UploadInstructions =
  | PresignedPostInstructions
  | PresignedPutInstructions
  | MultipartInstructions;

export interface InitiateUploadResponse {
  uploadId: string;
  instructions: UploadInstructions;
  constraints?: UploadConstraints;
  expiresAt?: string;
}

/* ------------------------------------------------------------------ */
/* Multipart                                                           */
/* ------------------------------------------------------------------ */

export interface PresignedPart {
  partNumber: number;
  url: string;
  headers?: Record<string, string>;
  expiresAt?: string;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
  checksum?: string;
  size?: number;
}

export interface SignPartsRequest {
  uploadId: string;
  parts: Array<{ partNumber: number; size: number; checksum?: string }>;
}

export interface SignPartsResponse {
  parts: PresignedPart[];
}

/* ------------------------------------------------------------------ */
/* Completion, cancellation, status                                    */
/* ------------------------------------------------------------------ */

export interface CompleteUploadRequest {
  uploadId: string;
  strategy: UploadStrategy;
  /** Present for multipart uploads, sorted by part number. */
  parts?: CompletedPart[];
  /** ETag / checksum returned by storage for single-request uploads, if any. */
  etag?: string;
  checksum?: string;
}

export interface AbortUploadRequest {
  uploadId: string;
  reason?: "user_canceled" | "validation_failed";
}

export type RemoteUploadState =
  | "pending"
  | "uploading"
  | "uploaded"
  | "processing"
  | "completed"
  | "failed"
  | "aborted"
  | "expired";

export interface ProcessingInfo {
  /** Backend-defined stage label, displayed verbatim. */
  stage?: string;
  /** 0..1 */
  progress?: number;
  message?: string;
}

export interface UploadStatusResponse {
  uploadId: string;
  state: RemoteUploadState;
  processing?: ProcessingInfo;
  /** Arbitrary backend result (document ID, object key, ...). Displayed as JSON. */
  result?: Record<string, unknown>;
  error?: { code?: string; message: string };
  /** Hint for when to poll again. */
  pollAfterMs?: number;
  completedParts?: CompletedPart[];
}

/* ------------------------------------------------------------------ */
/* Adapter + transport                                                 */
/* ------------------------------------------------------------------ */

/**
 * Per-call context. `uploadKey` authenticates against the *API*;
 * it is never sent to object storage.
 */
export interface AdapterContext {
  uploadKey: string;
  signal?: AbortSignal;
}

export interface UploadBackendAdapter {
  readonly id: string;
  initiate(req: InitiateUploadRequest, ctx: AdapterContext): Promise<InitiateUploadResponse>;
  signParts(req: SignPartsRequest, ctx: AdapterContext): Promise<SignPartsResponse>;
  complete(req: CompleteUploadRequest, ctx: AdapterContext): Promise<UploadStatusResponse>;
  abort(req: AbortUploadRequest, ctx: AdapterContext): Promise<void>;
  getStatus(uploadId: string, ctx: AdapterContext): Promise<UploadStatusResponse>;
}

export interface TransportRequest {
  method: "PUT" | "POST";
  url: string;
  headers?: Record<string, string>;
  body: Blob | FormData;
  signal?: AbortSignal;
  /** `loaded` is bytes of the request body sent so far. */
  onProgress?: (loaded: number) => void;
  timeoutMs?: number;
}

export interface TransportResponse {
  status: number;
  getHeader(name: string): string | null;
  text: string;
}

/** Sends bytes to object storage. Never attaches API credentials. */
export interface UploadTransport {
  send(req: TransportRequest): Promise<TransportResponse>;
}

/* ------------------------------------------------------------------ */
/* Engine options                                                      */
/* ------------------------------------------------------------------ */

export interface RetryOptions {
  /** Total attempts including the first. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  factor?: number;
  /** Full jitter (random 0..delay). Default true. */
  jitter?: boolean;
}

export interface UploadEngineOptions {
  partSize: number;
  concurrency: number;
  retry: RetryOptions;
  pollIntervalMs: number;
  maxPollMs: number;
  /** Per storage request timeout; 0 disables. */
  requestTimeoutMs: number;
}
