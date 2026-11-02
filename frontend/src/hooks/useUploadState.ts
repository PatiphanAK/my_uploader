"use client";

import { useSyncExternalStore } from "react";
import type { UploadSession } from "@/lib/upload/session";
import type { UploadState } from "@/lib/upload/state";

const noopSubscribe = () => () => {};
const getNull = () => null;

/** Subscribe to an UploadSession's immutable snapshot. Returns null when there is no session yet. */
export function useUploadState(session: UploadSession | undefined): UploadState | null {
  return useSyncExternalStore(
    session ? session.subscribe : noopSubscribe,
    session ? session.getSnapshot : getNull,
    getNull,
  );
}
