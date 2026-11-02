import { abortError, errorFromApiStatus, UploadError } from "../errors";
import { planParts } from "../multipart";
import type {
  ChecksumAlgorithm,
  InitiateUploadResponse,
  PresignedPart,
  ProcessingInfo,
  TransportRequest,
  TransportResponse,
  UploadBackendAdapter,
  UploadStatusResponse,
  UploadStrategy,
  UploadTransport,
} from "../types";

/**
 * In-browser mock backend + storage for demos and local development.
 * Nothing leaves the browser; bytes are not read, only "transferred" at a
 * simulated bandwidth so progress, speed, ETA, pause and retry are realistic.
 *
 * Magic upload keys:
 *   - `invalid`  → 401 on initiate
 *   - `expired`  → 410 on initiate
 *   - `flaky`    → 20% of part uploads fail with 503 (exercises retry)
 *   - `fail-processing` → processing ends in a backend-reported failure
 */

export const MOCK_STORAGE_HOST = "storage.mock.invalid";

export interface MockBackendOptions {
  /** Files at or above this size use multipart. */
  multipartThreshold?: number;
  /** Below this size use presigned POST, otherwise PUT (for single uploads). */
  postThreshold?: number;
  minPartSize?: number;
  bandwidthBps?: number;
  latencyMs?: number;
  checksum?: ChecksumAlgorithm;
  processingMs?: number;
  maxFileSize?: number;
  random?: () => number;
}

interface MockUpload {
  id: string;
  key: string;
  size: number;
  strategy: UploadStrategy;
  partSize?: number;
  parts: Map<number, string>;
  state: UploadStatusResponse["state"];
  completedAt?: number;
  fileName: string;
}

const STAGES = ["queued", "scanning", "processing", "finalizing"];

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(abortError());
      },
      { once: true },
    );
  });
}

export function createMockBackend(opts: MockBackendOptions = {}) {
  const o = {
    multipartThreshold: 16 * 1024 * 1024,
    postThreshold: 1024 * 1024,
    minPartSize: 5 * 1024 * 1024,
    bandwidthBps: 3 * 1024 * 1024, // per request; parallel parts add up
    latencyMs: 120,
    processingMs: 6000,
    maxFileSize: 50 * 1024 * 1024 * 1024,
    random: Math.random,
    ...opts,
  };
  const uploads = new Map<string, MockUpload>();
  let seq = 0;

  const get = (id: string): MockUpload => {
    const u = uploads.get(id);
    if (!u) throw errorFromApiStatus(404, "Unknown upload");
    return u;
  };
  const signUrl = (id: string, part?: number) =>
    `https://${MOCK_STORAGE_HOST}/${id}${part ? `/part/${part}` : ""}?sig=mock&exp=${Date.now() + 15 * 60_000}`;

  function status(u: MockUpload): UploadStatusResponse {
    if (u.state === "processing" && u.completedAt !== undefined) {
      const progress = Math.min(1, (Date.now() - u.completedAt) / o.processingMs);
      if (progress >= 1) {
        if (u.key === "fail-processing") {
          u.state = "failed";
          return { uploadId: u.id, state: "failed", error: { code: "mock", message: "Mock processor rejected the file" } };
        }
        u.state = "completed";
      } else {
        const processing: ProcessingInfo = {
          stage: STAGES[Math.min(STAGES.length - 1, Math.floor(progress * STAGES.length))],
          progress,
          message: "Simulated backend processing",
        };
        return { uploadId: u.id, state: "processing", processing, pollAfterMs: 800 };
      }
    }
    if (u.state === "completed") {
      return {
        uploadId: u.id,
        state: "completed",
        processing: { stage: "done", progress: 1 },
        result: { objectKey: `mock/${u.id}/${u.fileName}`, bytes: u.size, strategy: u.strategy },
      };
    }
    return { uploadId: u.id, state: u.state };
  }

  const adapter: UploadBackendAdapter = {
    id: "mock",
    async initiate(req, ctx): Promise<InitiateUploadResponse> {
      await wait(o.latencyMs, ctx.signal);
      if (!ctx.uploadKey) throw errorFromApiStatus(401, "Missing upload key");
      if (ctx.uploadKey === "invalid") throw errorFromApiStatus(401, "Upload key not recognized (mock)");
      if (ctx.uploadKey === "expired") throw errorFromApiStatus(410, "Upload key expired (mock)");
      if (req.file.size > o.maxFileSize) throw errorFromApiStatus(413);

      if (req.resumeUploadId) {
        const prev = uploads.get(req.resumeUploadId);
        if (prev && prev.state === "uploading" && prev.size === req.file.size && prev.strategy === "multipart") {
          return {
            uploadId: prev.id,
            instructions: {
              strategy: "multipart",
              partSize: prev.partSize!,
              resumable: true,
              checksum: o.checksum ? { algorithm: o.checksum } : undefined,
              completedParts: [...prev.parts].map(([partNumber, etag]) => ({ partNumber, etag })),
            },
          };
        }
      }

      const id = `mock-${Date.now().toString(36)}-${(++seq).toString(36)}`;
      const strategy: UploadStrategy =
        req.file.size >= o.multipartThreshold ? "multipart" : req.file.size < o.postThreshold ? "post" : "put";
      const u: MockUpload = {
        id,
        key: ctx.uploadKey,
        size: req.file.size,
        strategy,
        parts: new Map(),
        state: "uploading",
        fileName: req.file.name,
      };
      uploads.set(id, u);

      if (strategy === "multipart") {
        // Respect the client preference within S3-like bounds (min 5 MiB, max 10k parts).
        const minForCount = Math.ceil(req.file.size / 10_000);
        u.partSize = Math.max(o.minPartSize, minForCount, req.client.preferredPartSize);
        return {
          uploadId: id,
          instructions: {
            strategy: "multipart",
            partSize: u.partSize,
            totalParts: planParts(req.file.size, u.partSize).length,
            partUrlBatchSize: 8,
            resumable: true,
            checksum: o.checksum ? { algorithm: o.checksum } : undefined,
          },
        };
      }
      if (strategy === "post") {
        return {
          uploadId: id,
          instructions: { strategy: "post", url: signUrl(id), fields: { key: `mock/${id}`, policy: "mock" } },
        };
      }
      return { uploadId: id, instructions: { strategy: "put", url: signUrl(id), headers: { "Content-Type": req.file.type || "application/octet-stream" } } };
    },

    async signParts(req, ctx) {
      await wait(o.latencyMs / 2, ctx.signal);
      const u = get(req.uploadId);
      if (u.state !== "uploading") throw errorFromApiStatus(410, "Upload no longer active");
      const parts: PresignedPart[] = req.parts.map((p) => ({
        partNumber: p.partNumber,
        url: signUrl(u.id, p.partNumber),
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      }));
      return { parts };
    },

    async complete(req, ctx) {
      await wait(o.latencyMs, ctx.signal);
      const u = get(req.uploadId);
      if (u.state === "processing" || u.state === "completed") return status(u); // idempotent
      if (u.strategy === "multipart") {
        const expected = planParts(u.size, u.partSize!).length;
        if (!req.parts || req.parts.length !== expected) throw new UploadError("http", "Mock: missing parts", { status: 400 });
        for (const p of req.parts) {
          if (u.parts.get(p.partNumber) !== p.etag) throw new UploadError("http", `Mock: bad ETag for part ${p.partNumber}`, { status: 400 });
        }
      }
      u.state = "processing";
      u.completedAt = Date.now();
      return status(u);
    },

    async abort(req) {
      const u = uploads.get(req.uploadId);
      if (u && u.state === "uploading") u.state = "aborted";
    },

    async getStatus(uploadId, ctx) {
      await wait(o.latencyMs / 2, ctx.signal);
      return status(get(uploadId));
    },
  };

  const transport: UploadTransport = {
    async send(req: TransportRequest): Promise<TransportResponse> {
      const url = new URL(req.url);
      if (url.hostname !== MOCK_STORAGE_HOST) throw new UploadError("network", "Mock transport: unknown host");
      if (Object.keys(req.headers ?? {}).some((h) => h.toLowerCase() === "authorization")) {
        throw new UploadError("protocol", "Mock storage received an Authorization header — this must never happen");
      }
      const [, id, , partStr] = url.pathname.split("/");
      const u = uploads.get(id);
      if (!u || u.state !== "uploading") return { status: 403, text: "AccessDenied", getHeader: () => null };

      const size =
        req.body instanceof Blob ? req.body.size : ((req.body.get("file") as Blob | null)?.size ?? 0);
      await wait(o.latencyMs, req.signal);

      const flaky = u.key === "flaky" && partStr !== undefined && o.random() < 0.2;
      const failAt = flaky ? Math.floor(size * o.random()) : Infinity;
      const tickMs = 50;
      const perTick = Math.max(1, Math.round((o.bandwidthBps * tickMs) / 1000));
      for (let sent = 0; sent < size; ) {
        await wait(tickMs, req.signal);
        sent = Math.min(size, sent + perTick);
        req.onProgress?.(sent);
        if (sent >= failAt) return { status: 503, text: "SlowDown (mock)", getHeader: () => null };
      }
      if (size === 0) req.onProgress?.(0);

      const etag = `"${id}-${partStr ?? "0"}-${size}"`;
      if (partStr) u.parts.set(Number(partStr), etag);
      return {
        status: req.method === "POST" ? 204 : 200,
        text: "",
        getHeader: (n) => (n.toLowerCase() === "etag" ? etag : null),
      };
    },
  };

  return { adapter, transport, storageHosts: [MOCK_STORAGE_HOST] };
}
