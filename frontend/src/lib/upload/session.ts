import type { DestinationPolicy } from "./destination";
import { toUploadError, UploadError, type UploadErrorCode } from "./errors";
import { planParts, runMultipartUpload } from "./multipart";
import { ProgressTracker } from "./progress";
import { fileFingerprint, type ResumeStore } from "./resume";
import { sleep as defaultSleep, withRetry } from "./retry";
import { runPostUpload, runPutUpload, type SingleResult } from "./single";
import {
  canCancel,
  canPause,
  canResume,
  canRetry,
  initialUploadState,
  uploadReducer,
  type UploadEvent,
  type UploadState,
} from "./state";
import {
  SUPPORTED_CHECKSUMS,
  SUPPORTED_STRATEGIES,
  type AdapterContext,
  type CompletedPart,
  type InitiateUploadRequest,
  type InitiateUploadResponse,
  type UploadBackendAdapter,
  type UploadEngineOptions,
  type UploadInstructions,
  type UploadStatusResponse,
  type UploadTransport,
} from "./types";
import { validateFile } from "./validation";

export interface UploadSessionDeps {
  adapter: UploadBackendAdapter;
  transport: UploadTransport;
  destination: DestinationPolicy;
  allowStorageAuthHeader?: boolean;
  resumeStore?: ResumeStore;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  progressIntervalMs?: number;
}

export interface UploadSessionInit {
  file: File;
  uploadKey: string;
  profileId: string;
  options: UploadEngineOptions;
}

type Stage = "initiate" | "transfer" | "complete" | "poll" | "done";

/** Error codes the user cannot fix by simply retrying. */
const FINAL_CODES: ReadonlySet<UploadErrorCode> = new Set([
  "too_large",
  "unsupported_type",
  "validation",
  "destination",
  "processing_failed",
  "protocol",
]);

/**
 * Orchestrates one file upload: initiate → transfer → complete → poll.
 * Exposes an immutable snapshot + subscribe() for useSyncExternalStore.
 *
 * The upload key lives only in this object's memory and is only handed to
 * the adapter (API calls) — never to the storage transport.
 */
export class UploadSession {
  readonly file: File;
  readonly profileId: string;

  private state: UploadState;
  private listeners = new Set<() => void>();
  private stage: Stage = "initiate";
  private uploadKey: string;
  private readonly options: UploadEngineOptions;
  private readonly deps: UploadSessionDeps;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  private uploadId?: string;
  private instructions?: UploadInstructions;
  private completed = new Map<number, CompletedPart>();
  private singleResult?: SingleResult;
  private tracker: ProgressTracker;
  private run?: AbortController;
  private running?: Promise<void>;
  private pausing = false;
  private lastPollAfterMs?: number;

  constructor(init: UploadSessionInit, deps: UploadSessionDeps) {
    this.file = init.file;
    this.profileId = init.profileId;
    this.uploadKey = init.uploadKey;
    this.options = init.options;
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? defaultSleep;
    this.state = initialUploadState(init.file.size);
    this.tracker = new ProgressTracker(init.file.size, { now: this.now });
  }

  /* ---------------- external store ---------------- */

  getSnapshot = (): UploadState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private dispatch(event: UploadEvent) {
    const next = uploadReducer(this.state, event);
    if (next === this.state) return;
    this.state = next;
    for (const l of this.listeners) l();
  }

  /* ---------------- commands ---------------- */

  start(): Promise<void> {
    if (this.state.phase !== "idle") return this.running ?? Promise.resolve();
    this.dispatch({ type: "INITIATE", at: this.now() });
    return this.execute();
  }

  pause() {
    if (!canPause(this.state)) return;
    this.pausing = true;
    this.dispatch({ type: "PAUSE" });
    this.run?.abort();
  }

  async resume(): Promise<void> {
    if (!canResume(this.state)) return;
    await this.running;
    this.dispatch({ type: "RESUME" });
    return this.execute();
  }

  /** Retry after a failure. Optionally swap the upload key (e.g. after a 401). */
  async retry(uploadKey?: string): Promise<void> {
    if (!canRetry(this.state)) return;
    if (uploadKey) this.uploadKey = uploadKey;
    await this.running;

    if (this.stage === "poll") {
      this.dispatch({ type: "PROCESSING", watching: true });
      return this.execute();
    }

    const restart =
      this.stage === "initiate" ||
      this.instructions?.strategy !== "multipart" ||
      this.state.error?.code === "expired";

    if (restart) {
      this.abortRemote();
      this.deps.resumeStore?.remove(this.profileId, fileFingerprint(this.file));
      this.resetUpload();
      this.dispatch({ type: "INITIATE", at: this.now() });
    } else {
      this.dispatch({ type: "RESUME" });
    }
    return this.execute();
  }

  async cancel(): Promise<void> {
    if (!canCancel(this.state)) return;
    this.run?.abort();
    this.dispatch({ type: "CANCELED", at: this.now() });
    this.abortRemote();
    this.deps.resumeStore?.remove(this.profileId, fileFingerprint(this.file));
    this.stage = "done";
  }

  /** Stop all local work without notifying the backend (e.g. component unmount). */
  dispose() {
    this.run?.abort();
    this.listeners.clear();
  }

  /* ---------------- pipeline ---------------- */

  private ctx(signal: AbortSignal): AdapterContext {
    return { uploadKey: this.uploadKey, signal };
  }

  private retryOpts(signal: AbortSignal) {
    return {
      ...this.options.retry,
      signal,
      sleep: this.sleep,
      onRetry: () => this.dispatch({ type: "RETRYING" }),
    };
  }

  private execute(): Promise<void> {
    const ctrl = new AbortController();
    this.run = ctrl;
    this.pausing = false;
    const p = this.pipeline(ctrl.signal).catch((err) => this.handleError(err, ctrl.signal));
    this.running = p;
    return p;
  }

  private async pipeline(signal: AbortSignal) {
    if (this.stage === "initiate") await this.initiate(signal);
    if (this.stage === "transfer") await this.transfer(signal);
    if (this.stage === "complete") await this.complete(signal);
    if (this.stage === "poll") {
      // Polling runs in the background so callers (e.g. a queue) can move on.
      const polling = this.poll(signal).catch((err) => this.handleError(err, signal));
      this.running = polling;
    }
  }

  private handleError(raw: unknown, signal: AbortSignal) {
    const err = toUploadError(raw);
    if (err.code === "aborted" || signal.aborted) {
      // Pause, cancel or dispose — the command already set the phase.
      if (this.pausing) this.emitProgress();
      return;
    }
    this.dispatch({
      type: "FAILED",
      at: this.now(),
      error: { code: err.code, message: err.message, retryable: !FINAL_CODES.has(err.code) },
    });
  }

  private resetUpload() {
    this.stage = "initiate";
    this.uploadId = undefined;
    this.instructions = undefined;
    this.singleResult = undefined;
    this.completed.clear();
    this.tracker = new ProgressTracker(this.file.size, { now: this.now });
  }

  private abortRemote() {
    const uploadId = this.uploadId;
    if (!uploadId) return;
    // Best effort; a fresh signal because the run signal is already aborted.
    this.deps.adapter
      .abort({ uploadId, reason: "user_canceled" }, { uploadKey: this.uploadKey })
      .catch(() => {});
  }

  private async initiate(signal: AbortSignal) {
    const { adapter, resumeStore } = this.deps;
    const fingerprint = fileFingerprint(this.file);
    const record = resumeStore?.get(this.profileId, fingerprint);

    const request = (resumeUploadId?: string): InitiateUploadRequest => ({
      file: {
        name: this.file.name,
        size: this.file.size,
        type: this.file.type,
        lastModified: this.file.lastModified,
      },
      client: {
        strategies: [...SUPPORTED_STRATEGIES],
        checksumAlgorithms: [...SUPPORTED_CHECKSUMS],
        resumable: !!resumeStore,
        preferredPartSize: this.options.partSize,
        maxConcurrency: this.options.concurrency,
      },
      ...(resumeUploadId ? { resumeUploadId } : {}),
    });

    const call = (req: InitiateUploadRequest) =>
      withRetry(() => adapter.initiate(req, this.ctx(signal)), this.retryOpts(signal));

    let res: InitiateUploadResponse;
    try {
      res = await call(request(record?.uploadId));
    } catch (raw) {
      const err = toUploadError(raw);
      if (!record || (err.code !== "not_found" && err.code !== "expired")) throw err;
      resumeStore?.remove(this.profileId, fingerprint);
      res = await call(request());
    }

    this.uploadId = res.uploadId;

    const issues = validateFile(this.file, res.constraints);
    if (issues.length) {
      adapter.abort({ uploadId: res.uploadId, reason: "validation_failed" }, { uploadKey: this.uploadKey }).catch(() => {});
      this.uploadId = undefined;
      throw new UploadError("validation", issues.join("; "));
    }

    this.instructions = res.instructions;
    this.completed.clear();
    this.tracker = new ProgressTracker(this.file.size, { now: this.now });

    let partsTotal: number | undefined;
    let preUploaded = 0;
    const inst = res.instructions;
    if (inst.strategy === "multipart") {
      const plan = planParts(this.file.size, inst.partSize);
      partsTotal = plan.length;
      for (const cp of inst.completedParts ?? []) {
        const p = plan[cp.partNumber - 1];
        if (!p || this.completed.has(cp.partNumber)) continue;
        this.completed.set(cp.partNumber, cp);
        preUploaded += p.end - p.start;
      }
      this.tracker.addPreCommitted(preUploaded);
      if (inst.resumable && resumeStore) {
        resumeStore.save({ profileId: this.profileId, fingerprint, uploadId: res.uploadId, savedAt: this.now() });
      }
    }

    this.dispatch({
      type: "INITIATED",
      uploadId: res.uploadId,
      strategy: inst.strategy,
      resumable: inst.strategy === "multipart" && !!inst.resumable,
      resumed: !!record && record.uploadId === res.uploadId && this.completed.size > 0,
      partsTotal,
      partsCompleted: this.completed.size,
      uploadedBytes: preUploaded,
    });
    this.stage = "transfer";
  }

  private emitProgress() {
    const s = this.tracker.sample();
    this.dispatch({
      type: "PROGRESS",
      uploadedBytes: s.uploadedBytes,
      speedBps: s.speedBps,
      etaSeconds: s.etaSeconds,
      partsCompleted: this.instructions?.strategy === "multipart" ? this.completed.size : undefined,
    });
  }

  private async transfer(signal: AbortSignal) {
    const inst = this.instructions!;
    const tracker = this.tracker;
    tracker.resetAllInFlight();
    tracker.resetSpeed();

    const common = {
      transport: this.deps.transport,
      destination: this.deps.destination,
      allowStorageAuthHeader: this.deps.allowStorageAuthHeader,
      retry: this.options.retry,
      requestTimeoutMs: this.options.requestTimeoutMs || undefined,
      signal,
      sleep: this.sleep,
      onRetry: () => this.dispatch({ type: "RETRYING" }),
    };

    const ticker = setInterval(() => this.emitProgress(), this.deps.progressIntervalMs ?? 200);
    try {
      switch (inst.strategy) {
        case "multipart":
          await runMultipartUpload({
            ...common,
            file: this.file,
            uploadId: this.uploadId!,
            plan: inst,
            adapter: this.deps.adapter,
            ctx: this.ctx(signal),
            concurrency: this.options.concurrency,
            completed: this.completed,
            onPartProgress: (n, loaded) => tracker.update(n, loaded),
            onPartReset: (n) => tracker.reset(n),
            onPartComplete: (p, size) => tracker.commit(p.partNumber, size),
          });
          break;
        case "put":
          this.singleResult = await runPutUpload(inst, {
            ...common,
            file: this.file,
            onProgress: (loaded) => tracker.update(0, loaded),
          });
          tracker.commit(0, this.file.size);
          break;
        case "post":
          this.singleResult = await runPostUpload(inst, {
            ...common,
            file: this.file,
            fileName: this.file.name,
            onProgress: (loaded) => tracker.update(0, loaded),
          });
          tracker.commit(0, this.file.size);
          break;
      }
    } finally {
      clearInterval(ticker);
      this.emitProgress();
    }
    this.stage = "complete";
  }

  private async complete(signal: AbortSignal) {
    this.dispatch({ type: "COMPLETING" });
    const inst = this.instructions!;
    const parts =
      inst.strategy === "multipart"
        ? [...this.completed.values()].sort((a, b) => a.partNumber - b.partNumber)
        : undefined;
    const status = await withRetry(
      () =>
        this.deps.adapter.complete(
          {
            uploadId: this.uploadId!,
            strategy: inst.strategy,
            ...(parts ? { parts } : {}),
            ...(this.singleResult?.etag ? { etag: this.singleResult.etag } : {}),
            ...(this.singleResult?.checksum ? { checksum: this.singleResult.checksum } : {}),
          },
          this.ctx(signal),
        ),
      this.retryOpts(signal),
    );
    this.deps.resumeStore?.remove(this.profileId, fileFingerprint(this.file));
    this.stage = "poll";
    this.lastPollAfterMs = status.pollAfterMs;
    if (this.applyStatus(status)) this.stage = "done";
  }

  /** Returns true when the status is terminal. */
  private applyStatus(status: UploadStatusResponse): boolean {
    switch (status.state) {
      case "completed":
        this.dispatch({ type: "COMPLETED", at: this.now(), result: status.result, info: status.processing });
        return true;
      case "failed":
      case "aborted":
      case "expired":
        throw new UploadError(
          status.state === "expired" ? "expired" : "processing_failed",
          status.error?.message ?? `Backend reported the upload as ${status.state}`,
        );
      default:
        this.dispatch({ type: "PROCESSING", info: status.processing, watching: true });
        return false;
    }
  }

  private async poll(signal: AbortSignal) {
    const deadline = this.now() + this.options.maxPollMs;
    let delay = this.lastPollAfterMs ?? this.options.pollIntervalMs;
    for (;;) {
      if (this.now() + delay > deadline) {
        this.dispatch({ type: "PROCESSING", watching: false });
        return;
      }
      await this.sleep(delay, signal);
      const status = await withRetry(
        () => this.deps.adapter.getStatus(this.uploadId!, this.ctx(signal)),
        this.retryOpts(signal),
      );
      if (this.applyStatus(status)) {
        this.stage = "done";
        return;
      }
      delay = status.pollAfterMs ?? Math.min(Math.round(delay * 1.5), 15_000);
    }
  }
}
