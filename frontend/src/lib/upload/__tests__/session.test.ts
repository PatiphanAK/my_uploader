import { describe, expect, it } from "vitest";
import { createMockBackend } from "../adapters/mock";
import { UploadError } from "../errors";
import { createMemoryResumeStore } from "../resume";
import { UploadSession, type UploadSessionDeps } from "../session";
import type { UploadPhase } from "../state";
import type { TransportRequest, UploadBackendAdapter, UploadEngineOptions } from "../types";
import { makeFile } from "./fakes";

const OPTIONS: UploadEngineOptions = {
  partSize: 256,
  concurrency: 2,
  retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, jitter: false },
  pollIntervalMs: 1,
  maxPollMs: 10_000,
  requestTimeoutMs: 0,
};

function backend(extra: Parameters<typeof createMockBackend>[0] = {}) {
  const mock = createMockBackend({
    multipartThreshold: 1024,
    postThreshold: 100,
    minPartSize: 256,
    bandwidthBps: 256 * 20, // one part every ~50ms tick
    latencyMs: 0,
    processingMs: 20,
    ...extra,
  });
  const sent: number[] = [];
  const aborts: string[] = [];
  const adapter: UploadBackendAdapter = {
    ...mock.adapter,
    abort: async (req, ctx) => {
      aborts.push(req.uploadId);
      return mock.adapter.abort(req, ctx);
    },
  };
  const deps: UploadSessionDeps = {
    adapter,
    transport: {
      send: (req: TransportRequest) => {
        const part = new URL(req.url).pathname.split("/")[3];
        sent.push(part ? Number(part) : 0);
        return mock.transport.send(req);
      },
    },
    destination: { allowedHosts: mock.storageHosts },
    progressIntervalMs: 5,
  };
  return { deps, sent, aborts };
}

function track(session: UploadSession) {
  const phases: UploadPhase[] = [];
  session.subscribe(() => {
    const p = session.getSnapshot().phase;
    if (phases.at(-1) !== p) phases.push(p);
  });
  return phases;
}

function until(session: UploadSession, pred: (s: ReturnType<UploadSession["getSnapshot"]>) => boolean, ms = 5000) {
  return new Promise<void>((resolve, reject) => {
    if (pred(session.getSnapshot())) return resolve();
    const t = setTimeout(() => reject(new Error(`timeout; phase=${session.getSnapshot().phase}`)), ms);
    const off = session.subscribe(() => {
      if (pred(session.getSnapshot())) {
        clearTimeout(t);
        off();
        resolve();
      }
    });
  });
}

const newSession = (deps: UploadSessionDeps, size: number, key = "demo", file = makeFile(size)) =>
  new UploadSession({ file, uploadKey: key, profileId: "mock", options: OPTIONS }, deps);

describe("UploadSession", () => {
  it("runs a multipart upload through processing to completion", async () => {
    const { deps } = backend();
    const s = newSession(deps, 2000);
    const phases = track(s);
    await s.start();
    await until(s, (st) => st.phase === "completed");

    expect(phases).toEqual(["initiating", "uploading", "completing", "processing", "completed"]);
    const st = s.getSnapshot();
    expect(st.strategy).toBe("multipart");
    expect(st.uploadedBytes).toBe(2000);
    expect(st.partsCompleted).toBe(8);
    expect(st.result).toMatchObject({ bytes: 2000, strategy: "multipart" });
  });

  it.each([
    [50, "post"],
    [500, "put"],
  ])("uploads a %d-byte file with %s", async (size, strategy) => {
    const { deps } = backend();
    const s = newSession(deps, size);
    await s.start();
    await until(s, (st) => st.phase === "completed");
    expect(s.getSnapshot().strategy).toBe(strategy);
    expect(s.getSnapshot().uploadedBytes).toBe(size);
  });

  it("fails on a rejected key and succeeds when retried with a new key", async () => {
    const { deps } = backend();
    const s = newSession(deps, 500, "invalid");
    await s.start();
    expect(s.getSnapshot()).toMatchObject({ phase: "failed", error: { code: "unauthorized", retryable: true } });

    await s.retry("demo");
    await until(s, (st) => st.phase === "completed");
  });

  it("pauses and resumes without re-uploading completed parts", async () => {
    const { deps, sent } = backend();
    const s = newSession(deps, 2560); // 10 parts
    const started = s.start();
    await until(s, (st) => st.partsCompleted >= 2);
    s.pause();
    await started;
    expect(s.getSnapshot().phase).toBe("paused");
    const doneAtPause = s.getSnapshot().partsCompleted;
    const sentAtPause = sent.length;

    await s.resume();
    await until(s, (st) => st.phase === "completed");
    const afterResume = sent.slice(sentAtPause);
    // Parts finished before the pause are never re-sent.
    expect(afterResume.length).toBeLessThanOrEqual(10 - doneAtPause + OPTIONS.concurrency);
    expect(new Set(sent).size).toBe(10);
  });

  it("cancels an in-flight upload and aborts it on the backend", async () => {
    const { deps, aborts } = backend();
    const s = newSession(deps, 2560);
    const started = s.start();
    await until(s, (st) => st.phase === "uploading");
    const uploadId = s.getSnapshot().uploadId!;
    await s.cancel();
    await started;
    expect(s.getSnapshot().phase).toBe("canceled");
    expect(aborts).toEqual([uploadId]);
    // Nothing moves after cancel.
    const snap = s.getSnapshot();
    await new Promise((r) => setTimeout(r, 100));
    expect(s.getSnapshot()).toBe(snap);
  });

  it("retries transient storage errors and counts them", async () => {
    const { deps } = backend();
    let attempts = 0;
    const inner = deps.transport;
    const failedOnce = new Set<string>();
    deps.transport = {
      async send(req) {
        attempts++;
        if (!failedOnce.has(req.url)) {
          failedOnce.add(req.url);
          return { status: 503, text: "SlowDown", getHeader: () => null };
        }
        return inner.send(req);
      },
    };
    const s = newSession(deps, 1024);
    await s.start();
    await until(s, (st) => st.phase === "completed");
    expect(s.getSnapshot().retries).toBeGreaterThanOrEqual(4);
    expect(attempts).toBe(8);
  });

  it("resumes a multipart upload in a new session (e.g. after reload) without storing the key", async () => {
    const { deps } = backend();
    const store = createMemoryResumeStore();
    deps.resumeStore = store;
    const file = makeFile(2560);

    const first = newSession(deps, 0, "demo", file);
    const started = first.start();
    await until(first, (st) => st.partsCompleted >= 3);
    first.dispose(); // simulate tab reload: no backend abort
    await started;

    const record = store.get("mock", `${file.name}\u0000${file.size}\u0000${file.lastModified}`);
    expect(record?.uploadId).toBe(first.getSnapshot().uploadId);
    expect(JSON.stringify(record)).not.toContain("demo");

    const second = newSession(deps, 0, "demo", file);
    await second.start();
    await until(second, (st) => st.phase === "completed");
    expect(second.getSnapshot().resumed).toBe(true);
    expect(second.getSnapshot().uploadId).toBe(record?.uploadId);
  });

  it("reports backend processing failures as non-retryable", async () => {
    const { deps } = backend();
    const s = newSession(deps, 500, "fail-processing");
    await s.start();
    await until(s, (st) => st.phase === "failed");
    expect(s.getSnapshot().error).toMatchObject({ code: "processing_failed", retryable: false });
  });

  it("rejects files that violate backend constraints and aborts the upload", async () => {
    const { deps, aborts } = backend();
    const inner = deps.adapter;
    deps.adapter = {
      ...inner,
      initiate: async (req, ctx) => ({ ...(await inner.initiate(req, ctx)), constraints: { maxFileSize: 100 } }),
    };
    const s = newSession(deps, 500);
    await s.start();
    expect(s.getSnapshot()).toMatchObject({ phase: "failed", error: { code: "validation", retryable: false } });
    await new Promise((r) => setTimeout(r, 10));
    expect(aborts).toHaveLength(1);
  });

  it("restarts from scratch when the backend says the session expired", async () => {
    const { deps } = backend();
    const inner = deps.adapter;
    let completes = 0;
    deps.adapter = {
      ...inner,
      complete: async (req, ctx) => {
        if (++completes === 1) throw new UploadError("expired", "gone");
        return inner.complete(req, ctx);
      },
    };
    const s = newSession(deps, 500);
    await s.start();
    expect(s.getSnapshot().error?.code).toBe("expired");
    const firstId = s.getSnapshot().uploadId;
    await s.retry();
    await until(s, (st) => st.phase === "completed");
    expect(s.getSnapshot().uploadId).not.toBe(firstId);
  });
});
