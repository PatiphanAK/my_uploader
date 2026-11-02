/**
 * Resume records let a multipart upload continue after a page reload.
 *
 * They contain NO secrets: only the profile ID, a file fingerprint and the
 * backend's uploadId. The upload key is never persisted — the user re-enters
 * it, and the backend decides whether that key may continue the upload.
 */

export interface ResumeRecord {
  profileId: string;
  fingerprint: string;
  uploadId: string;
  savedAt: number;
}

export interface ResumeStore {
  get(profileId: string, fingerprint: string): ResumeRecord | undefined;
  save(record: ResumeRecord): void;
  remove(profileId: string, fingerprint: string): void;
}

export function fileFingerprint(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

const STORAGE_KEY = "universal-upload:resume:v1";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const keyOf = (profileId: string, fingerprint: string) => `${profileId}\u0000${fingerprint}`;

export function createMemoryResumeStore(): ResumeStore {
  const map = new Map<string, ResumeRecord>();
  return {
    get: (p, f) => map.get(keyOf(p, f)),
    save: (r) => void map.set(keyOf(r.profileId, r.fingerprint), r),
    remove: (p, f) => void map.delete(keyOf(p, f)),
  };
}

/** localStorage-backed store. Falls back to no-op when storage is unavailable. */
export function createLocalResumeStore(
  storage: Pick<Storage, "getItem" | "setItem"> | null = typeof window === "undefined" ? null : safeLocalStorage(),
  ttlMs = DEFAULT_TTL_MS,
  now: () => number = Date.now,
): ResumeStore {
  const read = (): Record<string, ResumeRecord> => {
    if (!storage) return {};
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  const write = (all: Record<string, ResumeRecord>) => {
    if (!storage) return;
    try {
      const fresh = Object.fromEntries(Object.entries(all).filter(([, r]) => now() - r.savedAt < ttlMs));
      storage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    } catch {
      /* quota / disabled storage: resume across reloads is best-effort */
    }
  };
  return {
    get(p, f) {
      const r = read()[keyOf(p, f)];
      return r && now() - r.savedAt < ttlMs && typeof r.uploadId === "string" ? r : undefined;
    },
    save(r) {
      const all = read();
      all[keyOf(r.profileId, r.fingerprint)] = {
        profileId: r.profileId,
        fingerprint: r.fingerprint,
        uploadId: r.uploadId,
        savedAt: r.savedAt,
      };
      write(all);
    },
    remove(p, f) {
      const all = read();
      delete all[keyOf(p, f)];
      write(all);
    },
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
