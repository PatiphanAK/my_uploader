import { describe, expect, it } from "vitest";
import {
  canCancel,
  canPause,
  canResume,
  canRetry,
  initialUploadState,
  uploadReducer,
  type UploadEvent,
  type UploadState,
} from "../state";

const run = (events: UploadEvent[], start = initialUploadState(1000)) => events.reduce(uploadReducer, start);

const INITIATED: UploadEvent = {
  type: "INITIATED",
  uploadId: "u1",
  strategy: "multipart",
  resumable: true,
  resumed: false,
  partsTotal: 4,
};

describe("uploadReducer", () => {
  it("follows the happy path to completed", () => {
    const phases: string[] = [];
    let s = initialUploadState(1000);
    for (const e of [
      { type: "INITIATE", at: 1 },
      INITIATED,
      { type: "PROGRESS", uploadedBytes: 500, speedBps: 100, etaSeconds: 5, partsCompleted: 2 },
      { type: "COMPLETING" },
      { type: "PROCESSING", info: { stage: "queued" }, watching: true },
      { type: "COMPLETED", at: 9, result: { id: "doc1" } },
    ] as UploadEvent[]) {
      s = uploadReducer(s, e);
      phases.push(s.phase);
    }
    expect(phases).toEqual(["initiating", "uploading", "uploading", "completing", "processing", "completed"]);
    expect(s.uploadedBytes).toBe(1000);
    expect(s.partsCompleted).toBe(4);
    expect(s.result).toEqual({ id: "doc1" });
    expect(s.finishedAt).toBe(9);
  });

  it("pauses and resumes multipart uploads only", () => {
    const s = run([{ type: "INITIATE", at: 0 }, INITIATED]);
    expect(canPause(s)).toBe(true);
    const paused = uploadReducer(s, { type: "PAUSE" });
    expect(paused.phase).toBe("paused");
    expect(canResume(paused)).toBe(true);
    expect(uploadReducer(paused, { type: "RESUME" }).phase).toBe("uploading");

    const put = run([{ type: "INITIATE", at: 0 }, { ...INITIATED, strategy: "put" } as UploadEvent]);
    expect(canPause(put)).toBe(false);
    expect(uploadReducer(put, { type: "PAUSE" })).toBe(put);
  });

  it("zeroes speed and ETA while paused", () => {
    const s = run([
      { type: "INITIATE", at: 0 },
      INITIATED,
      { type: "PAUSE" },
      { type: "PROGRESS", uploadedBytes: 300, speedBps: 999, etaSeconds: 3 },
    ]);
    expect(s.uploadedBytes).toBe(300);
    expect(s.speedBps).toBe(0);
    expect(s.etaSeconds).toBeNull();
  });

  it("ignores events that are invalid for the current phase", () => {
    const idle = initialUploadState(10);
    expect(uploadReducer(idle, { type: "COMPLETING" })).toBe(idle);
    expect(uploadReducer(idle, { type: "PROGRESS", uploadedBytes: 5, speedBps: 1, etaSeconds: 1 })).toBe(idle);

    const canceled = run([{ type: "INITIATE", at: 0 }, INITIATED, { type: "CANCELED", at: 1 }]);
    // Late progress or completion after cancel must not resurrect the upload.
    expect(uploadReducer(canceled, { type: "PROGRESS", uploadedBytes: 5, speedBps: 1, etaSeconds: 1 })).toBe(canceled);
    expect(uploadReducer(canceled, { type: "COMPLETED", at: 2 })).toBe(canceled);
    expect(uploadReducer(canceled, { type: "FAILED", at: 2, error: { code: "network", message: "", retryable: true } })).toBe(
      canceled,
    );
  });

  it("records failures and allows retry only when retryable", () => {
    const failed = run([
      { type: "INITIATE", at: 0 },
      INITIATED,
      { type: "FAILED", at: 5, error: { code: "network", message: "down", retryable: true } },
    ]);
    expect(failed.phase).toBe("failed");
    expect(canRetry(failed)).toBe(true);
    expect(canCancel(failed)).toBe(true);

    const final: UploadState = { ...failed, error: { code: "too_large", message: "", retryable: false } };
    expect(canRetry(final)).toBe(false);
  });

  it("retries a failed multipart upload by resuming, or restarts via INITIATE", () => {
    const failed = run([
      { type: "INITIATE", at: 0 },
      INITIATED,
      { type: "PROGRESS", uploadedBytes: 400, speedBps: 0, etaSeconds: null, partsCompleted: 2 },
      { type: "FAILED", at: 5, error: { code: "network", message: "", retryable: true } },
    ]);
    const resumed = uploadReducer(failed, { type: "RESUME" });
    expect(resumed.phase).toBe("uploading");
    expect(resumed.uploadedBytes).toBe(400);
    expect(resumed.error).toBeUndefined();

    const restarted = uploadReducer(failed, { type: "INITIATE", at: 6 });
    expect(restarted.phase).toBe("initiating");
    expect(restarted.uploadedBytes).toBe(0);
    expect(restarted.uploadId).toBeUndefined();
  });

  it("supports processing without active polling (manual refresh)", () => {
    const s = run([
      { type: "INITIATE", at: 0 },
      INITIATED,
      { type: "COMPLETING" },
      { type: "PROCESSING", info: { stage: "embedding", progress: 0.5 }, watching: true },
      { type: "PROCESSING", watching: false },
    ]);
    expect(s.processing).toEqual({ stage: "embedding", progress: 0.5, watching: false });
    expect(canRetry(s)).toBe(true);
    expect(canCancel(s)).toBe(false);
  });

  it("counts retries and resets only from terminal phases", () => {
    const s = run([{ type: "INITIATE", at: 0 }, INITIATED, { type: "RETRYING" }, { type: "RETRYING" }]);
    expect(s.retries).toBe(2);
    expect(uploadReducer(s, { type: "RESET" })).toBe(s);
    const done = run([{ type: "CANCELED", at: 1 }], s);
    expect(uploadReducer(done, { type: "RESET" }).phase).toBe("idle");
  });
});
