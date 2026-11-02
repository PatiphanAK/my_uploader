import type { ProcessingInfo, UploadStrategy } from "./types";
import type { UploadErrorCode } from "./errors";

/**
 * Pure state machine for a single upload. The session drives it with events;
 * the UI renders the resulting snapshot. Invalid transitions are ignored, so
 * late events (e.g. progress after cancel) cannot corrupt the state.
 *
 *   idle → initiating → uploading ⇄ paused
 *                          ↓
 *                     completing → processing → completed
 *   any active phase → failed | canceled;  failed → (retry) initiating | uploading | processing
 */

export type UploadPhase =
  | "idle"
  | "initiating"
  | "uploading"
  | "paused"
  | "completing"
  | "processing"
  | "completed"
  | "failed"
  | "canceled";

export interface UploadErrorInfo {
  code: UploadErrorCode;
  message: string;
  retryable: boolean;
}

export interface UploadState {
  phase: UploadPhase;
  totalBytes: number;
  uploadedBytes: number;
  speedBps: number;
  etaSeconds: number | null;
  uploadId?: string;
  strategy?: UploadStrategy;
  resumable: boolean;
  /** True when this upload continued a previous session's multipart upload. */
  resumed: boolean;
  partsTotal?: number;
  partsCompleted: number;
  retries: number;
  error?: UploadErrorInfo;
  processing?: ProcessingInfo & { watching: boolean };
  result?: Record<string, unknown>;
  startedAt?: number;
  finishedAt?: number;
}

export type UploadEvent =
  | { type: "INITIATE"; at: number }
  | {
      type: "INITIATED";
      uploadId: string;
      strategy: UploadStrategy;
      resumable: boolean;
      resumed: boolean;
      partsTotal?: number;
      partsCompleted?: number;
      uploadedBytes?: number;
    }
  | { type: "PROGRESS"; uploadedBytes: number; speedBps: number; etaSeconds: number | null; partsCompleted?: number }
  | { type: "RETRYING" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "COMPLETING" }
  | { type: "PROCESSING"; info?: ProcessingInfo; watching: boolean }
  | { type: "COMPLETED"; at: number; result?: Record<string, unknown>; info?: ProcessingInfo }
  | { type: "FAILED"; at: number; error: UploadErrorInfo }
  | { type: "CANCELED"; at: number }
  | { type: "RESET" };

export function initialUploadState(totalBytes: number): UploadState {
  return {
    phase: "idle",
    totalBytes,
    uploadedBytes: 0,
    speedBps: 0,
    etaSeconds: null,
    resumable: false,
    resumed: false,
    partsCompleted: 0,
    retries: 0,
  };
}

const ACTIVE: ReadonlySet<UploadPhase> = new Set(["initiating", "uploading", "paused", "completing"]);

export function uploadReducer(state: UploadState, event: UploadEvent): UploadState {
  const { phase } = state;
  switch (event.type) {
    case "INITIATE":
      if (phase !== "idle" && phase !== "failed") return state;
      return {
        ...initialUploadState(state.totalBytes),
        phase: "initiating",
        startedAt: event.at,
        retries: state.retries,
      };

    case "INITIATED":
      if (phase !== "initiating") return state;
      return {
        ...state,
        phase: "uploading",
        uploadId: event.uploadId,
        strategy: event.strategy,
        resumable: event.resumable,
        resumed: event.resumed,
        partsTotal: event.partsTotal,
        partsCompleted: event.partsCompleted ?? 0,
        uploadedBytes: event.uploadedBytes ?? 0,
      };

    case "PROGRESS":
      if (phase !== "uploading" && phase !== "paused") return state;
      return {
        ...state,
        uploadedBytes: event.uploadedBytes,
        speedBps: phase === "paused" ? 0 : event.speedBps,
        etaSeconds: phase === "paused" ? null : event.etaSeconds,
        partsCompleted: event.partsCompleted ?? state.partsCompleted,
      };

    case "RETRYING":
      if (!ACTIVE.has(phase) && phase !== "processing") return state;
      return { ...state, retries: state.retries + 1 };

    case "PAUSE":
      if (phase !== "uploading" || state.strategy !== "multipart") return state;
      return { ...state, phase: "paused", speedBps: 0, etaSeconds: null };

    case "RESUME":
      if (phase !== "paused" && !(phase === "failed" && state.uploadId)) return state;
      return { ...state, phase: "uploading", error: undefined };

    case "COMPLETING":
      if (phase !== "uploading") return state;
      return {
        ...state,
        phase: "completing",
        uploadedBytes: state.totalBytes,
        partsCompleted: state.partsTotal ?? state.partsCompleted,
        speedBps: 0,
        etaSeconds: 0,
      };

    case "PROCESSING":
      if (phase !== "completing" && phase !== "processing" && phase !== "failed") return state;
      return {
        ...state,
        phase: "processing",
        error: undefined,
        processing: { ...state.processing, ...event.info, watching: event.watching },
      };

    case "COMPLETED":
      if (phase !== "completing" && phase !== "processing") return state;
      return {
        ...state,
        phase: "completed",
        finishedAt: event.at,
        result: event.result,
        processing: event.info ? { ...event.info, watching: false } : state.processing && { ...state.processing, watching: false },
      };

    case "FAILED":
      if (!ACTIVE.has(phase) && phase !== "processing") return state;
      return { ...state, phase: "failed", error: event.error, finishedAt: event.at, speedBps: 0, etaSeconds: null };

    case "CANCELED":
      if (!ACTIVE.has(phase) && phase !== "failed") return state;
      return { ...state, phase: "canceled", finishedAt: event.at, speedBps: 0, etaSeconds: null };

    case "RESET":
      if (ACTIVE.has(phase) || phase === "processing") return state;
      return initialUploadState(state.totalBytes);

    default:
      return state;
  }
}

/* Selectors used by the UI. */
export const canPause = (s: UploadState) => s.phase === "uploading" && s.strategy === "multipart";
export const canResume = (s: UploadState) => s.phase === "paused";
export const canCancel = (s: UploadState) => ACTIVE.has(s.phase) || (s.phase === "failed" && !!s.uploadId);
export const canRetry = (s: UploadState) =>
  (s.phase === "failed" && !!s.error?.retryable) || (s.phase === "processing" && s.processing?.watching === false);
export const isActive = (s: UploadState) => ACTIVE.has(s.phase);
export const isTerminal = (s: UploadState) => s.phase === "completed" || s.phase === "canceled";
