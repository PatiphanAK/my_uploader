import { assertSafeApiBase } from "../upload/destination";
import type { StandardRoutes } from "../upload/adapters/standard";
import type { UploadConstraints } from "../upload/types";

/**
 * A backend profile says *where* upload keys are sent and *which* storage
 * hosts the backend may direct bytes to. Profiles contain no secrets.
 *
 * Sources:
 *  - builtin: the in-browser mock (and the local mock server in development)
 *  - env:     NEXT_PUBLIC_UPLOAD_PROFILES (JSON array), baked in at build time — trusted
 *  - custom:  added by the user in the UI, saved to localStorage — untrusted until
 *             confirmed per session before the first key is sent
 */

export type AdapterKind = "standard" | "mock";

export interface BackendProfile {
  id: string;
  name: string;
  description?: string;
  adapter: AdapterKind;
  /** Required for `standard`. HTTPS (HTTP allowed only for loopback). */
  apiBaseUrl?: string;
  /** Storage host patterns presigned URLs may point to. Defaults to the API host. */
  allowedUploadHosts?: string[];
  /** Forward backend-supplied Authorization headers to storage. Off by default. */
  allowStorageAuthHeader?: boolean;
  routes?: Partial<StandardRoutes>;
  /** Client-side hints for early validation; the backend remains authoritative. */
  hints?: UploadConstraints;
  source: "builtin" | "env" | "custom";
  trusted: boolean;
}

export const MOCK_PROFILE: BackendProfile = {
  id: "mock",
  name: "In-browser mock",
  description: "Simulated backend; nothing leaves your browser. Try keys: demo, flaky, invalid, expired, fail-processing.",
  adapter: "mock",
  source: "builtin",
  trusted: true,
};

export const LOCAL_MOCK_SERVER_PROFILE: BackendProfile = {
  id: "local-mock-server",
  name: "Local mock server",
  description: "scripts/mock-backend.mjs on http://localhost:4010 (npm run mock:server)",
  adapter: "standard",
  apiBaseUrl: "http://localhost:4010/api",
  allowedUploadHosts: ["localhost:4010"],
  source: "builtin",
  trusted: true,
};

const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/i;

/** Validate and normalize an untrusted profile object (env JSON or user input). */
export function normalizeProfile(raw: unknown, source: BackendProfile["source"]): BackendProfile {
  if (!raw || typeof raw !== "object") throw new Error("Profile must be an object");
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "");
  if (!ID_RE.test(id)) throw new Error(`Invalid profile id "${id}"`);
  const name = String(r.name ?? id).slice(0, 80);
  const adapter = (r.adapter ?? "standard") as AdapterKind;
  if (adapter !== "standard" && adapter !== "mock") throw new Error(`Unknown adapter "${String(adapter)}"`);

  let apiBaseUrl: string | undefined;
  let allowedUploadHosts: string[] | undefined;
  if (adapter === "standard") {
    apiBaseUrl = assertSafeApiBase(String(r.apiBaseUrl ?? ""));
    const hosts = Array.isArray(r.allowedUploadHosts) ? r.allowedUploadHosts.map(String) : [];
    allowedUploadHosts = hosts.map((h) => h.trim()).filter(Boolean);
    if (!allowedUploadHosts.length) allowedUploadHosts = [new URL(apiBaseUrl).host];
    for (const h of allowedUploadHosts) {
      if (h === "*" || h === "*.") throw new Error("Wildcard-only storage hosts are not allowed");
      if (/[/\s?#@]/.test(h)) throw new Error(`Invalid storage host pattern "${h}"`);
    }
  }

  const hints = r.hints && typeof r.hints === "object" ? (r.hints as UploadConstraints) : undefined;
  return {
    id,
    name,
    description: typeof r.description === "string" ? r.description.slice(0, 200) : undefined,
    adapter,
    apiBaseUrl,
    allowedUploadHosts,
    allowStorageAuthHeader: r.allowStorageAuthHeader === true,
    routes: r.routes && typeof r.routes === "object" ? (r.routes as Partial<StandardRoutes>) : undefined,
    hints,
    source,
    trusted: source !== "custom",
  };
}

export function parseProfilesJson(json: string | undefined, source: BackendProfile["source"]): BackendProfile[] {
  if (!json?.trim()) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) throw new Error("expected an array");
    return arr.flatMap((p) => {
      try {
        return [normalizeProfile(p, source)];
      } catch (e) {
        console.warn(`[upload] Ignoring invalid ${source} profile:`, e);
        return [];
      }
    });
  } catch (e) {
    console.warn(`[upload] Could not parse ${source} profiles:`, e);
    return [];
  }
}

/** Profiles available at build time. */
export function getConfiguredProfiles(): BackendProfile[] {
  const env = parseProfilesJson(process.env.NEXT_PUBLIC_UPLOAD_PROFILES, "env");
  const out: BackendProfile[] = [...env];
  if (process.env.NEXT_PUBLIC_ENABLE_MOCK !== "false") out.push(MOCK_PROFILE);
  if (process.env.NODE_ENV === "development") out.push(LOCAL_MOCK_SERVER_PROFILE);
  return out;
}

const CUSTOM_KEY = "universal-upload:profiles:v1";

export function loadCustomProfiles(): BackendProfile[] {
  try {
    return parseProfilesJson(window.localStorage.getItem(CUSTOM_KEY) ?? undefined, "custom");
  } catch {
    return [];
  }
}

export function saveCustomProfiles(profiles: BackendProfile[]) {
  try {
    const data = profiles
      .filter((p) => p.source === "custom")
      .map(({ id, name, description, adapter, apiBaseUrl, allowedUploadHosts, routes }) => ({
        id,
        name,
        description,
        adapter,
        apiBaseUrl,
        allowedUploadHosts,
        routes,
      }));
    window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable: custom profiles last for this session only */
  }
}
