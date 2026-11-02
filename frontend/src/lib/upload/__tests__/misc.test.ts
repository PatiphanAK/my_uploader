import { describe, expect, it, vi } from "vitest";
import { normalizeProfile, parseProfilesJson } from "../../config/profiles";
import { createStandardAdapter } from "../adapters/standard";
import { parseInitiateResponse, parseStatusResponse } from "../contract";
import { assertSafeApiBase, assertSafeUploadUrl, sanitizeStorageHeaders } from "../destination";
import { ProgressTracker } from "../progress";
import { createLocalResumeStore } from "../resume";
import { validateFile } from "../validation";

describe("destination policy", () => {
  const policy = { allowedHosts: ["*.r2.cloudflarestorage.com", "uploads.example.com", "localhost:4010"] };

  it("accepts allowed HTTPS hosts and wildcard subdomains", () => {
    expect(() => assertSafeUploadUrl("https://acct.r2.cloudflarestorage.com/b/k?X-Amz=1", policy)).not.toThrow();
    expect(() => assertSafeUploadUrl("https://uploads.example.com/x", policy)).not.toThrow();
  });

  it("rejects other hosts, bare wildcard parents, http and embedded credentials", () => {
    expect(() => assertSafeUploadUrl("https://evil.example/x", policy)).toThrow(/not in this profile/);
    expect(() => assertSafeUploadUrl("https://r2.cloudflarestorage.com/x", policy)).toThrow();
    expect(() => assertSafeUploadUrl("https://uploads.example.com.evil.io/x", policy)).toThrow();
    expect(() => assertSafeUploadUrl("http://uploads.example.com/x", policy)).toThrow(/HTTPS/);
    expect(() => assertSafeUploadUrl("https://u:p@uploads.example.com/x", policy)).toThrow(/credentials/);
    expect(() => assertSafeUploadUrl("javascript:alert(1)", policy)).toThrow();
  });

  it("allows plain HTTP only on loopback, with port-specific patterns", () => {
    expect(() => assertSafeUploadUrl("http://localhost:4010/s", policy)).not.toThrow();
    expect(() => assertSafeUploadUrl("http://localhost:9999/s", policy)).toThrow();
    expect(assertSafeApiBase("http://127.0.0.1:4010/api/")).toBe("http://127.0.0.1:4010/api");
    expect(() => assertSafeApiBase("http://api.example.com")).toThrow(/HTTPS/);
    expect(() => assertSafeApiBase("https://api.example.com/?token=x")).toThrow(/query/);
  });

  it("strips credential and forbidden headers from storage requests", () => {
    const h = { Authorization: "Bearer k", Cookie: "a", "Content-Type": "text/plain", "x-amz-acl": "private" };
    expect(sanitizeStorageHeaders(h)).toEqual({ "Content-Type": "text/plain", "x-amz-acl": "private" });
    expect(sanitizeStorageHeaders(h, { allowAuthorization: true })).toHaveProperty("Authorization");
  });
});

describe("ProgressTracker", () => {
  it("computes speed from wire bytes and ETA from remaining bytes", () => {
    let t = 0;
    const p = new ProgressTracker(1000, { now: () => t });
    p.sample();
    t = 1000;
    p.update(1, 200);
    const s = p.sample();
    expect(s.uploadedBytes).toBe(200);
    expect(s.speedBps).toBe(200);
    expect(s.etaSeconds).toBe(4);
  });

  it("drops in-flight bytes on reset without making speed negative", () => {
    let t = 0;
    const p = new ProgressTracker(1000, { now: () => t });
    p.sample();
    p.update(1, 300);
    p.reset(1);
    t = 1000;
    p.update(1, 100);
    const s = p.sample();
    expect(s.uploadedBytes).toBe(100);
    expect(s.speedBps).toBe(400);
  });

  it("counts resumed bytes as uploaded but not toward speed", () => {
    let t = 0;
    const p = new ProgressTracker(1000, { now: () => t });
    p.addPreCommitted(500);
    p.sample();
    t = 1000;
    expect(p.sample()).toMatchObject({ uploadedBytes: 500, speedBps: 0, etaSeconds: null });
  });
});

describe("contract parsing", () => {
  it("parses multipart instructions and normalizes checksum names", () => {
    const r = parseInitiateResponse({
      uploadId: "u",
      instructions: { strategy: "multipart", partSize: 5242880, checksum: { algorithm: "sha256" } },
    });
    expect(r.instructions).toMatchObject({ strategy: "multipart", checksum: { algorithm: "SHA256" } });
  });

  it("rejects malformed responses with protocol errors", () => {
    expect(() => parseInitiateResponse({ uploadId: "u", instructions: { strategy: "ftp" } })).toThrow(/unknown strategy/);
    expect(() => parseInitiateResponse({ instructions: {} })).toThrow(/uploadId/);
    expect(() => parseStatusResponse({ uploadId: "u", state: "weird" })).toThrow(/unknown state/);
  });

  it("clamps processing progress", () => {
    expect(parseStatusResponse({ uploadId: "u", state: "processing", processing: { progress: 3 } }).processing?.progress).toBe(1);
  });
});

describe("standard adapter", () => {
  it("authenticates API calls with the key and maps routes", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ uploadId: "u 1", state: "processing" }), { status: 200 }),
    );
    const a = createStandardAdapter({ baseUrl: "https://api.example.com/v1/", fetch: fetchMock });
    await a.getStatus("u 1", { uploadKey: "k" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/uploads/u%201");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(init?.credentials).toBe("omit");
    expect(String(url)).not.toContain("k&");
  });

  it("maps API error statuses and messages", async () => {
    const fetchMock = async () => new Response(JSON.stringify({ error: { message: "key revoked" } }), { status: 401 });
    const a = createStandardAdapter({ baseUrl: "https://api.example.com", fetch: fetchMock as typeof fetch });
    await expect(a.getStatus("u", { uploadKey: "k" })).rejects.toMatchObject({ code: "unauthorized", message: "key revoked" });
  });

  it("refuses insecure API base URLs", () => {
    expect(() => createStandardAdapter({ baseUrl: "http://api.example.com" })).toThrow();
  });
});

describe("profiles", () => {
  it("defaults storage hosts to the API host and marks custom profiles untrusted", () => {
    const p = normalizeProfile({ id: "tatarbot", apiBaseUrl: "https://api.tatarbot.dev" }, "custom");
    expect(p.allowedUploadHosts).toEqual(["api.tatarbot.dev"]);
    expect(p.trusted).toBe(false);
  });

  it("rejects bare wildcards and skips invalid env entries", () => {
    expect(() => normalizeProfile({ id: "x", apiBaseUrl: "https://a.b", allowedUploadHosts: ["*"] }, "env")).toThrow();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseProfilesJson('[{"id":"ok","apiBaseUrl":"https://a.b"},{"id":"bad","apiBaseUrl":"http://a.b"}]', "env")).toHaveLength(1);
    warn.mockRestore();
  });
});

describe("resume store", () => {
  it("persists only non-secret fields and expires old records", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    let now = 1000;
    const store = createLocalResumeStore(storage, 100, () => now);
    store.save({ profileId: "p", fingerprint: "f", uploadId: "u", savedAt: now, uploadKey: "SECRET" } as never);
    expect([...mem.values()].join()).not.toContain("SECRET");
    expect(store.get("p", "f")?.uploadId).toBe("u");
    now = 2000;
    expect(store.get("p", "f")).toBeUndefined();
  });
});

describe("validateFile", () => {
  it("checks size, MIME wildcards and extensions", () => {
    expect(validateFile({ name: "a.pdf", size: 10, type: "application/pdf" }, { maxFileSize: 5 })).toHaveLength(1);
    expect(validateFile({ name: "a.png", size: 1, type: "image/png" }, { allowedTypes: ["image/*"] })).toEqual([]);
    expect(validateFile({ name: "a.md", size: 1, type: "" }, { allowedTypes: ["text/markdown"], allowedExtensions: [".md"] })).toEqual([]);
    expect(validateFile({ name: "a.exe", size: 1, type: "" }, { allowedExtensions: [".md"] })).toHaveLength(1);
  });
});
