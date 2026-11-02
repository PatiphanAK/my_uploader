import { UploadError } from "./errors";
import type {
  ChecksumRequirement,
  CompletedPart,
  InitiateUploadResponse,
  PresignedPart,
  RemoteUploadState,
  SignPartsResponse,
  UploadInstructions,
  UploadStatusResponse,
} from "./types";
import { SUPPORTED_CHECKSUMS } from "./types";

/**
 * Runtime validation of backend responses. Backends are trusted to route,
 * not to be bug-free; malformed responses fail loudly with a protocol error
 * instead of producing undefined behaviour deep in the engine.
 */

type Obj = Record<string, unknown>;

const fail = (msg: string): never => {
  throw new UploadError("protocol", `Invalid backend response: ${msg}`);
};
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, f: string): string => (typeof v === "string" && v ? v : fail(`${f} must be a string`));
const optStr = (v: unknown, f: string) => (v === undefined || v === null ? undefined : str(v, f));
const posInt = (v: unknown, f: string): number =>
  Number.isInteger(v) && (v as number) > 0 ? (v as number) : fail(`${f} must be a positive integer`);
const optHeaders = (v: unknown, f: string): Record<string, string> | undefined => {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v) || Object.values(v).some((x) => typeof x !== "string")) fail(`${f} must map strings to strings`);
  return v as Record<string, string>;
};

function checksumReq(v: unknown): ChecksumRequirement | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) return fail("checksum must be an object");
  const algorithm = str(v.algorithm, "checksum.algorithm").toUpperCase();
  if (!(SUPPORTED_CHECKSUMS as readonly string[]).includes(algorithm)) fail(`unsupported checksum ${algorithm}`);
  return { algorithm: algorithm as ChecksumRequirement["algorithm"], header: optStr(v.header, "checksum.header") };
}

function presignedPart(v: unknown): PresignedPart {
  if (!isObj(v)) return fail("part must be an object");
  return {
    partNumber: posInt(v.partNumber, "part.partNumber"),
    url: str(v.url, "part.url"),
    headers: optHeaders(v.headers, "part.headers"),
    expiresAt: optStr(v.expiresAt, "part.expiresAt"),
  };
}

function completedParts(v: unknown): CompletedPart[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) return fail("completedParts must be an array");
  return v.map((p) => {
    if (!isObj(p)) return fail("completed part must be an object");
    return {
      partNumber: posInt(p.partNumber, "completedPart.partNumber"),
      etag: str(p.etag, "completedPart.etag"),
      checksum: optStr(p.checksum, "completedPart.checksum"),
      size: typeof p.size === "number" ? p.size : undefined,
    };
  });
}

function instructions(v: unknown): UploadInstructions {
  if (!isObj(v)) return fail("instructions must be an object");
  switch (v.strategy) {
    case "post": {
      const fields = optHeaders(v.fields, "instructions.fields") ?? {};
      return {
        strategy: "post",
        url: str(v.url, "instructions.url"),
        fields,
        fileField: optStr(v.fileField, "instructions.fileField"),
        expiresAt: optStr(v.expiresAt, "instructions.expiresAt"),
      };
    }
    case "put":
      return {
        strategy: "put",
        url: str(v.url, "instructions.url"),
        headers: optHeaders(v.headers, "instructions.headers"),
        checksum: checksumReq(v.checksum),
        expiresAt: optStr(v.expiresAt, "instructions.expiresAt"),
      };
    case "multipart":
      return {
        strategy: "multipart",
        partSize: posInt(v.partSize, "instructions.partSize"),
        totalParts: v.totalParts === undefined ? undefined : posInt(v.totalParts, "instructions.totalParts"),
        parts: Array.isArray(v.parts) ? v.parts.map(presignedPart) : undefined,
        partUrlBatchSize:
          v.partUrlBatchSize === undefined ? undefined : posInt(v.partUrlBatchSize, "instructions.partUrlBatchSize"),
        checksum: checksumReq(v.checksum),
        resumable: v.resumable === true,
        completedParts: completedParts(v.completedParts),
        expiresAt: optStr(v.expiresAt, "instructions.expiresAt"),
      };
    default:
      return fail(`unknown strategy ${JSON.stringify(v.strategy)}`);
  }
}

export function parseInitiateResponse(v: unknown): InitiateUploadResponse {
  if (!isObj(v)) return fail("expected an object");
  const c = v.constraints;
  return {
    uploadId: str(v.uploadId, "uploadId"),
    instructions: instructions(v.instructions),
    expiresAt: optStr(v.expiresAt, "expiresAt"),
    constraints: isObj(c)
      ? {
          maxFileSize: typeof c.maxFileSize === "number" ? c.maxFileSize : undefined,
          allowedTypes: Array.isArray(c.allowedTypes) ? c.allowedTypes.filter((x) => typeof x === "string") : undefined,
          allowedExtensions: Array.isArray(c.allowedExtensions)
            ? c.allowedExtensions.filter((x) => typeof x === "string")
            : undefined,
        }
      : undefined,
  };
}

export function parseSignPartsResponse(v: unknown): SignPartsResponse {
  if (!isObj(v) || !Array.isArray(v.parts)) return fail("expected { parts: [...] }");
  return { parts: v.parts.map(presignedPart) };
}

const STATES: readonly RemoteUploadState[] = [
  "pending",
  "uploading",
  "uploaded",
  "processing",
  "completed",
  "failed",
  "aborted",
  "expired",
];

export function parseStatusResponse(v: unknown): UploadStatusResponse {
  if (!isObj(v)) return fail("expected an object");
  const state = v.state as RemoteUploadState;
  if (!STATES.includes(state)) fail(`unknown state ${JSON.stringify(v.state)}`);
  const p = v.processing;
  const e = v.error;
  return {
    uploadId: str(v.uploadId, "uploadId"),
    state,
    processing: isObj(p)
      ? {
          stage: optStr(p.stage, "processing.stage"),
          progress: typeof p.progress === "number" ? Math.min(1, Math.max(0, p.progress)) : undefined,
          message: optStr(p.message, "processing.message"),
        }
      : undefined,
    result: isObj(v.result) ? v.result : undefined,
    error: isObj(e) ? { code: optStr(e.code, "error.code"), message: str(e.message, "error.message") } : undefined,
    pollAfterMs: typeof v.pollAfterMs === "number" && v.pollAfterMs > 0 ? v.pollAfterMs : undefined,
    completedParts: completedParts(v.completedParts),
  };
}
