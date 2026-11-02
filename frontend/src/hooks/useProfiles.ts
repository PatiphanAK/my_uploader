"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getConfiguredProfiles,
  loadCustomProfiles,
  saveCustomProfiles,
  type BackendProfile,
} from "@/lib/config/profiles";

const configured = getConfiguredProfiles();

export function useProfiles() {
  const [custom, setCustom] = useState<BackendProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(configured[0]?.id);

  useEffect(() => {
    // localStorage is only available after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCustom(loadCustomProfiles());
  }, []);

  const profiles = useMemo(() => {
    const ids = new Set(configured.map((p) => p.id));
    return [...configured, ...custom.filter((p) => !ids.has(p.id))];
  }, [custom]);

  const selected = profiles.find((p) => p.id === selectedId) ?? profiles[0];

  const addProfile = useCallback((p: BackendProfile) => {
    setCustom((prev) => {
      const next = [...prev.filter((x) => x.id !== p.id), p];
      saveCustomProfiles(next);
      return next;
    });
    setSelectedId(p.id);
  }, []);

  const removeProfile = useCallback((id: string) => {
    setCustom((prev) => {
      const next = prev.filter((x) => x.id !== id);
      saveCustomProfiles(next);
      return next;
    });
    setSelectedId((cur) => (cur === id ? configured[0]?.id : cur));
  }, []);

  return { profiles, selected, select: setSelectedId, addProfile, removeProfile };
}
