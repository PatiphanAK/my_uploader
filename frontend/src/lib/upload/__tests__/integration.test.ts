/**
 * End-to-end check of the standard adapter + session against scripts/mock-backend.mjs
 * over real HTTP. Uses a fetch-based transport (Node has no XMLHttpRequest).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStandardAdapter } from "../adapters/standard";
import { createMemoryResumeStore } from "../resume";
import { UploadSession } from "../session";
import type { UploadTransport } from "../types";
import { makeFile } from "./fakes";

const PORT = 41000 + Math.floor(Math.random() * 1000);
const SCRIPT = fileURLToPath(new URL("../../../../scripts/mock-backend.mjs", import.meta.url));
let server: ChildProcess;

const fetchTransport: UploadTransport = {
  async send(req) {
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: req.signal });
    const text = await res.text();
    req.onProgress?.(req.body instanceof Blob ? req.body.size : 0);
    return { status: res.status, text, getHeader: (n) => res.headers.get(n) };
  },
};

beforeAll(async () => {
  server = spawn(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      PORT: String(PORT),
      MOCK_CHECKSUM: "SHA256",
      MULTIPART_THRESHOLD: String(200 * 1024),
      MIN_PART_SIZE: String(64 * 1024),
      PROCESSING_MS: "50",
      POST_THRESHOLD: String(100 * 1024),
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    server.stdout!.on("data", (d) => String(d).includes("Mock upload backend") && resolve());
    server.on("exit", (code) => reject(new Error(`mock server exited ${code}`)));
  });
});

afterAll(() => {
  server?.kill();
});

function session(size: number, key = "dev-key") {
  return new UploadSession(
    {
      file: makeFile(size, `f-${size}.bin`),
      uploadKey: key,
      profileId: "local",
      options: {
        partSize: 64 * 1024,
        concurrency: 3,
        retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, jitter: false },
        pollIntervalMs: 20,
        maxPollMs: 5000,
        requestTimeoutMs: 0,
      },
    },
    {
      adapter: createStandardAdapter({ baseUrl: `http://localhost:${PORT}/api` }),
      transport: fetchTransport,
      destination: { allowedHosts: [`localhost:${PORT}`] },
      resumeStore: createMemoryResumeStore(),
      progressIntervalMs: 10,
    },
  );
}

async function finish(s: UploadSession) {
  await s.start();
  for (let i = 0; i < 200 && s.getSnapshot().phase === "processing"; i++) await new Promise((r) => setTimeout(r, 20));
  return s.getSnapshot();
}

describe("standard adapter against the mock server", () => {
  it.each([
    [10 * 1024, "post"],
    [150 * 1024, "put"],
    [300 * 1024 + 7, "multipart"],
  ])("uploads %d bytes via %s", async (size, strategy) => {
    const st = await finish(session(size));
    expect(st.error).toBeUndefined();
    expect(st.phase).toBe("completed");
    expect(st.strategy).toBe(strategy);
    expect(st.result).toMatchObject({ bytes: size });
  });

  it("verifies SHA-256 part checksums server-side", async () => {
    const st = await finish(session(260 * 1024));
    expect(st.phase).toBe("completed");
    expect(st.partsTotal).toBe(5);
  });

  it("surfaces API auth errors", async () => {
    const st = await finish(session(1024, "invalid"));
    expect(st.phase).toBe("failed");
    expect(st.error?.code).toBe("unauthorized");
  });
});
