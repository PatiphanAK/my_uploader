"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { BackendProfile } from "@/lib/config/profiles";
import { resolveBackend } from "@/lib/upload/adapters";
import { createLocalResumeStore, type ResumeStore } from "@/lib/upload/resume";
import { UploadSession } from "@/lib/upload/session";
import type { UploadEngineOptions } from "@/lib/upload/types";
import { validateFile } from "@/lib/upload/validation";

interface StoredItem {
  id: string;
  file: File;
  session?: UploadSession;
}

export interface QueueItem extends StoredItem {
  /** Client-side hint issues (from profile hints). Items with issues are not started. */
  issues: string[];
}

let seq = 0;
const nextId = () => `f${Date.now().toString(36)}${(++seq).toString(36)}`;

interface QueueConfig {
  profile: BackendProfile | undefined;
  uploadKey: string;
  options: UploadEngineOptions;
}

/**
 * Holds selected files and their upload sessions. Sessions capture the profile,
 * key and options at start time; later changes affect only files not yet started.
 */
export function useUploadQueue(config: QueueConfig) {
  const [stored, setItems] = useState<StoredItem[]>([]);
  const hints = config.profile?.hints;
  // Issues are derived, so they follow profile changes for files not yet started.
  const items: QueueItem[] = useMemo(
    () => stored.map((it) => ({ ...it, issues: it.session ? [] : validateFile(it.file, hints) })),
    [stored, hints],
  );
  const itemsRef = useRef(items);
  const configRef = useRef(config);
  const resumeStoreRef = useRef<ResumeStore | null>(null);
  const startedIds = useRef(new Set<string>());

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Re-render the queue owner when any session changes phase (not on every progress tick).
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const offs = items.flatMap((it) => {
      const s = it.session;
      if (!s) return [];
      let phase = s.getSnapshot().phase;
      return [
        s.subscribe(() => {
          const next = s.getSnapshot().phase;
          if (next !== phase) {
            phase = next;
            bump();
          }
        }),
      ];
    });
    return () => offs.forEach((off) => off());
  }, [items]);

  useEffect(
    () => () => {
      for (const it of itemsRef.current) it.session?.dispose();
    },
    [],
  );

  const addFiles = useCallback((files: Iterable<File>) => {
    const added = [...files].map((file) => ({ id: nextId(), file }));
    if (added.length) setItems((prev) => [...prev, ...added]);
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const it = prev.find((x) => x.id === id);
      if (it?.session) {
        void it.session.cancel();
        it.session.dispose();
      }
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const createSession = useCallback((item: StoredItem): UploadSession | undefined => {
    const { profile, uploadKey, options } = configRef.current;
    if (!profile || !uploadKey || startedIds.current.has(item.id)) return undefined;
    startedIds.current.add(item.id); // guards double-starts before React commits the session
    resumeStoreRef.current ??= createLocalResumeStore();
    const backend = resolveBackend(profile);
    const session = new UploadSession(
      { file: item.file, uploadKey, profileId: profile.id, options },
      { ...backend, resumeStore: resumeStoreRef.current },
    );
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, session } : x)));
    return session;
  }, []);

  const start = useCallback(
    async (id: string) => {
      const item = itemsRef.current.find((x) => x.id === id);
      if (!item || item.session) return;
      await createSession(item)?.start();
    },
    [createSession],
  );

  /** Start all ready files one after another (each file still uploads parts concurrently). */
  const startAll = useCallback(async () => {
    const ready = itemsRef.current.filter((x) => !x.session && x.issues.length === 0);
    for (const item of ready) {
      if (!itemsRef.current.some((x) => x.id === item.id)) continue; // removed meanwhile
      await createSession(item)?.start();
    }
  }, [createSession]);

  const clearFinished = useCallback(() => {
    setItems((prev) =>
      prev.filter((x) => {
        const phase = x.session?.getSnapshot().phase;
        const done = phase === "completed" || phase === "canceled";
        if (done) x.session?.dispose();
        return !done;
      }),
    );
  }, []);

  return { items, addFiles, remove, start, startAll, clearFinished };
}
