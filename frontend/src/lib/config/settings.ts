import { DEFAULT_RETRY } from "../upload/retry";
import type { UploadEngineOptions } from "../upload/types";

const MiB = 1024 * 1024;

export const PART_SIZE_CHOICES_MIB = [5, 8, 16, 32, 64, 128] as const;
export const CONCURRENCY_CHOICES = [1, 2, 4, 6, 8] as const;

export const DEFAULT_ENGINE_OPTIONS: UploadEngineOptions = {
  partSize: 8 * MiB,
  concurrency: 4,
  retry: DEFAULT_RETRY,
  pollIntervalMs: 2000,
  maxPollMs: 30 * 60_000,
  requestTimeoutMs: 0,
};

export interface UserTransferSettings {
  partSizeMiB: number;
  concurrency: number;
}

const KEY = "universal-upload:settings:v1";

export const DEFAULT_USER_SETTINGS: UserTransferSettings = { partSizeMiB: 8, concurrency: 4 };

export function loadUserSettings(): UserTransferSettings {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    if (
      raw &&
      (PART_SIZE_CHOICES_MIB as readonly number[]).includes(raw.partSizeMiB) &&
      (CONCURRENCY_CHOICES as readonly number[]).includes(raw.concurrency)
    ) {
      return { partSizeMiB: raw.partSizeMiB, concurrency: raw.concurrency };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_USER_SETTINGS;
}

export function saveUserSettings(s: UserTransferSettings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function engineOptionsFrom(s: UserTransferSettings): UploadEngineOptions {
  return { ...DEFAULT_ENGINE_OPTIONS, partSize: s.partSizeMiB * MiB, concurrency: s.concurrency };
}
