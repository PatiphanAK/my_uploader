import { UploadError } from "./errors";

/**
 * Guards for where bytes and credentials may go.
 *
 * - API base URLs and storage URLs must be HTTPS (plain HTTP only for loopback).
 * - Storage URLs must match the profile's allow-list.
 * - Credential headers are stripped from storage requests unless the profile
 *   explicitly opts in.
 */

export interface DestinationPolicy {
  /**
   * Host patterns: `storage.example.com`, `*.r2.cloudflarestorage.com`,
   * or with port `localhost:4010`. A pattern without a port matches any port.
   */
  allowedHosts: string[];
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLoopback(hostname: string): boolean {
  return LOOPBACK.has(hostname.toLowerCase());
}

export function hostMatches(url: URL, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  const target = p.includes(":") && !p.startsWith("[") ? url.host.toLowerCase() : url.hostname.toLowerCase();
  if (p.startsWith("*.")) {
    const suffix = p.slice(1); // ".example.com"
    return target.endsWith(suffix) && target.length > suffix.length;
  }
  return target === p;
}

function parse(raw: string, what: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw new UploadError("destination", `${what} is not a valid absolute URL`);
  }
}

function assertSecureScheme(url: URL, what: string) {
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && isLoopback(url.hostname)) return;
  throw new UploadError("destination", `${what} must use HTTPS (got ${url.protocol}//${url.host})`);
}

/** Validate an API base URL from a backend profile. Returns the normalized URL (no trailing slash). */
export function assertSafeApiBase(raw: string): string {
  const url = parse(raw, "API base URL");
  assertSecureScheme(url, "API base URL");
  if (url.username || url.password) throw new UploadError("destination", "API base URL must not embed credentials");
  if (url.search || url.hash) throw new UploadError("destination", "API base URL must not contain a query or fragment");
  return url.toString().replace(/\/+$/, "");
}

/** Validate a presigned storage URL returned by the backend. */
export function assertSafeUploadUrl(raw: string, policy: DestinationPolicy): URL {
  const url = parse(raw, "Upload URL");
  assertSecureScheme(url, "Upload URL");
  if (url.username || url.password) throw new UploadError("destination", "Upload URL must not embed credentials");
  if (!policy.allowedHosts.some((p) => hostMatches(url, p))) {
    throw new UploadError(
      "destination",
      `Upload URL host "${url.host}" is not in this profile's allowed storage hosts`,
    );
  }
  return url;
}

const ALWAYS_BLOCKED = new Set([
  "cookie",
  "host",
  "origin",
  "referer",
  "connection",
  "content-length",
  "transfer-encoding",
]);
const CREDENTIAL_HEADERS = new Set(["authorization", "proxy-authorization"]);

/**
 * Filter headers the backend asked us to send to storage. Drops browser-forbidden
 * headers and, unless `allowAuthorization`, any credential headers — so the API
 * upload key can never leak to object storage via backend-supplied headers.
 */
export function sanitizeStorageHeaders(
  headers: Record<string, string> | undefined,
  opts: { allowAuthorization?: boolean } = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (ALWAYS_BLOCKED.has(lower) || lower.startsWith("sec-")) continue;
    if (CREDENTIAL_HEADERS.has(lower) && !opts.allowAuthorization) continue;
    if (typeof value !== "string") continue;
    out[name] = value;
  }
  return out;
}
