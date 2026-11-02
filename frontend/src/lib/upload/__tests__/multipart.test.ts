import { describe, expect, it } from "vitest";
import { computeChecksum } from "../checksum";
import { UploadError } from "../errors";
import { planParts, runMultipartUpload, type MultipartRunParams } from "../multipart";
import { ProgressTracker } from "../progress";
import type { CompletedPart, MultipartInstructions } from "../types";
import { createFakeAdapter, createFakeStorage, makeFile, noSleep, STORAGE_HOST } from "./fakes";

const RETRY = { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 1, jitter: false };

function setup(size: number, partSize: number, plan: Partial<MultipartInstructions> = {}) {
  const file = makeFile(size);
  const storage = createFakeStorage();
  const fake = createFakeAdapter();
  const tracker = new ProgressTracker(size);
  const progressLog: number[] = [];
  const perPartMax = new Map<number, number>();
  const ctrl = new AbortController();
  const completed = new Map<number, CompletedPart>();
  const params: MultipartRunParams = {
    file,
    uploadId: "u1",
    plan: { strategy: "multipart", partSize, ...plan },
    adapter: fake.adapter,
    ctx: { uploadKey: "secret-key" },
    transport: storage.transport,
    destination: { allowedHosts: [STORAGE_HOST] },
    concurrency: 3,
    retry: RETRY,
    signal: ctrl.signal,
    completed,
    sleep: noSleep,
    onPartProgress: (n, loaded) => {
      perPartMax.set(n, Math.max(perPartMax.get(n) ?? 0, loaded));
      tracker.update(n, loaded);
      progressLog.push(tracker.uploadedBytes);
    },
    onPartReset: (n) => tracker.reset(n),
    onPartComplete: (p, s) => {
      tracker.commit(p.partNumber, s);
      progressLog.push(tracker.uploadedBytes);
    },
  };
  return { file, storage, fake, tracker, progressLog, perPartMax, ctrl, completed, params };
}

describe("planParts", () => {
  it("splits into fixed-size parts with a short last part", () => {
    expect(planParts(10, 4)).toEqual([
      { partNumber: 1, start: 0, end: 4 },
      { partNumber: 2, start: 4, end: 8 },
      { partNumber: 3, start: 8, end: 10 },
    ]);
  });
  it("handles exact multiples and empty files", () => {
    expect(planParts(8, 4)).toHaveLength(2);
    expect(planParts(0, 4)).toEqual([{ partNumber: 1, start: 0, end: 0 }]);
  });
  it("rejects invalid part sizes", () => {
    expect(() => planParts(10, 0)).toThrow(UploadError);
  });
});

describe("runMultipartUpload", () => {
  it("uploads every part and reports byte-accurate progress", async () => {
    const s = setup(1000, 128);
    const parts = await runMultipartUpload(s.params);

    expect(parts.map((p) => p.partNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parts.every((p) => p.etag === `"etag-${p.partNumber}"`)).toBe(true);
    expect(s.tracker.uploadedBytes).toBe(1000);
    expect(s.progressLog.at(-1)).toBe(1000);
    expect(Math.max(...s.progressLog)).toBeLessThanOrEqual(1000);
    // Per-part progress never exceeds the part's size.
    expect(s.perPartMax.get(8)).toBe(1000 - 7 * 128);
    // Part bodies are exact slices.
    expect(s.storage.calls.reduce((n, c) => n + c.size, 0)).toBe(1000);
  });

  it("respects the concurrency limit", async () => {
    const s = setup(2000, 100);
    s.params.concurrency = 3;
    await runMultipartUpload(s.params);
    expect(s.storage.maxActive).toBeLessThanOrEqual(3);
    expect(s.storage.maxActive).toBeGreaterThan(1);
  });

  it("batches part URL signing when no checksum is required", async () => {
    const s = setup(1000, 100, { partUrlBatchSize: 5 });
    s.params.concurrency = 1;
    await runMultipartUpload(s.params);
    expect(s.fake.signCalls).toHaveLength(2);
    expect(s.fake.signCalls[0].parts.map((p) => p.partNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it("retries transient part failures with backoff and resets that part's progress", async () => {
    const s = setup(400, 100);
    s.storage.fail(2, { status: 500 }, { status: 503 });
    const retries: number[] = [];
    s.params.onRetry = (_e, attempt) => retries.push(attempt);

    await runMultipartUpload(s.params);
    expect(s.storage.calls.filter((c) => c.part === 2)).toHaveLength(3);
    expect(retries).toEqual([1, 2]);
    expect(s.tracker.uploadedBytes).toBe(400);
  });

  it("gives up after maxAttempts and aborts sibling parts", async () => {
    const s = setup(1000, 100);
    s.storage.fail(1, { status: 500 }, { status: 500 }, { status: 500 }, { status: 500 });
    await expect(runMultipartUpload(s.params)).rejects.toMatchObject({ code: "server" });
    expect(s.completed.size).toBeLessThan(10);
  });

  it("does not retry non-retryable storage errors", async () => {
    const s = setup(300, 100);
    s.storage.fail(1, { status: 403, text: "AccessDenied" });
    await expect(runMultipartUpload(s.params)).rejects.toMatchObject({ code: "forbidden" });
    expect(s.storage.calls.filter((c) => c.part === 1)).toHaveLength(1);
  });

  it("re-signs a part whose presigned URL expired", async () => {
    const s = setup(200, 100, { partUrlBatchSize: 10 });
    s.storage.fail(1, { status: 403, text: "<Message>Request has expired</Message>" });
    await runMultipartUpload(s.params);
    const signedPart1 = s.fake.signCalls.filter((c) => c.parts.some((p) => p.partNumber === 1));
    expect(signedPart1).toHaveLength(2);
  });

  it("fails clearly when storage hides the ETag header", async () => {
    const s = setup(100, 100);
    s.storage.fail(1, "no-etag");
    await expect(runMultipartUpload(s.params)).rejects.toMatchObject({ code: "protocol" });
  });

  it("refuses presigned URLs outside the allowed storage hosts", async () => {
    const s = setup(100, 100);
    s.params.destination = { allowedHosts: ["other.example"] };
    await expect(runMultipartUpload(s.params)).rejects.toMatchObject({ code: "destination" });
    expect(s.storage.calls).toHaveLength(0);
  });

  it("never sends the upload key or Authorization headers to storage", async () => {
    const s = setup(200, 100);
    s.params.adapter = {
      ...s.fake.adapter,
      async signParts(req) {
        return {
          parts: req.parts.map((p) => ({
            partNumber: p.partNumber,
            url: `https://${STORAGE_HOST}/u/${p.partNumber}`,
            headers: { Authorization: "Bearer leaked", "x-amz-meta-a": "1" },
          })),
        };
      },
    };
    await runMultipartUpload(s.params);
    for (const c of s.storage.calls) {
      expect(Object.keys(c.headers).map((h) => h.toLowerCase())).not.toContain("authorization");
      expect(JSON.stringify(c.headers)).not.toContain("secret-key");
      expect(c.headers["x-amz-meta-a"]).toBe("1");
    }
  });

  it("computes per-part checksums, signs with them, and sends the checksum header", async () => {
    const s = setup(250, 100, { checksum: { algorithm: "SHA256" } });
    const parts = await runMultipartUpload(s.params);

    const expected2 = await computeChecksum(s.file.slice(100, 200), "SHA256");
    expect(parts[1].checksum).toBe(expected2);
    // Checksummed parts are signed one at a time, with the checksum.
    expect(s.fake.signCalls).toHaveLength(3);
    expect(s.fake.signCalls.find((c) => c.parts[0].partNumber === 2)?.parts[0].checksum).toBe(expected2);
    const call2 = s.storage.calls.find((c) => c.part === 2)!;
    expect(call2.headers["x-amz-checksum-sha256"]).toBe(expected2);
  });

  it("uses the backend-provided checksum header name", async () => {
    const s = setup(100, 100, { checksum: { algorithm: "CRC32C", header: "x-checksum" } });
    await runMultipartUpload(s.params);
    expect(s.storage.calls[0].headers["x-checksum"]).toBe(await computeChecksum(s.file, "CRC32C"));
  });

  it("verifies the part count against the backend", async () => {
    const s = setup(1000, 100, { totalParts: 3 });
    await expect(runMultipartUpload(s.params)).rejects.toMatchObject({ code: "protocol" });
  });
});

describe("cancellation and resume", () => {
  it("aborts in-flight requests and keeps completed parts for resuming", async () => {
    const s = setup(1000, 100);
    s.params.concurrency = 2;
    s.params.onPartComplete = (p) => {
      if (p.partNumber === 3) s.ctrl.abort();
    };
    await expect(runMultipartUpload(s.params)).rejects.toMatchObject({ code: "aborted" });
    const doneBefore = new Set(s.completed.keys());
    expect(doneBefore.size).toBeGreaterThan(0);
    expect(doneBefore.size).toBeLessThan(10);

    // Resume with a fresh signal: only outstanding parts are uploaded.
    const callsBefore = s.storage.calls.length;
    const ctrl2 = new AbortController();
    const parts = await runMultipartUpload({ ...s.params, signal: ctrl2.signal, onPartComplete: undefined });
    expect(parts).toHaveLength(10);
    const resumedParts = s.storage.calls.slice(callsBefore).map((c) => c.part);
    for (const n of doneBefore) expect(resumedParts).not.toContain(n);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const s = setup(100, 100);
    s.ctrl.abort();
    await expect(runMultipartUpload(s.params)).rejects.toMatchObject({ code: "aborted" });
    expect(s.storage.calls).toHaveLength(0);
  });
});
