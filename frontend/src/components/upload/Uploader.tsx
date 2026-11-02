"use client";

import { Plus, ShieldCheck, ShieldAlert, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Select } from "@/components/ui/Select";
import { Button, Panel } from "@/components/ui/primitives";
import { useProfiles } from "@/hooks/useProfiles";
import { useUploadQueue } from "@/hooks/useUploadQueue";
import type { BackendProfile } from "@/lib/config/profiles";
import {
  DEFAULT_USER_SETTINGS,
  engineOptionsFrom,
  loadUserSettings,
  saveUserSettings,
  type UserTransferSettings,
} from "@/lib/config/settings";
import { formatBytes } from "@/lib/format";
import type { UploadSession } from "@/lib/upload/session";
import { acceptAttribute } from "@/lib/upload/validation";
import { AddProfileDialog } from "./AddProfileDialog";
import { DropZone } from "./DropZone";
import { TransferSettings } from "./TransferSettings";
import { TrustDialog } from "./TrustDialog";
import { UploadItem } from "./UploadItem";
import { UploadKeyInput } from "./UploadKeyInput";

export function Uploader() {
  const { profiles, selected: profile, select, addProfile, removeProfile } = useProfiles();
  // The upload key lives only in React state (memory). It is cleared when switching profiles.
  const [uploadKey, setUploadKey] = useState("");
  const [settings, setSettings] = useState<UserTransferSettings>(DEFAULT_USER_SETTINGS);
  const [addOpen, setAddOpen] = useState(false);

  // Origins the user confirmed this session (memory only).
  const trustedOrigins = useRef(new Set<string>());
  const [pendingTrust, setPendingTrust] = useState<{ profile: BackendProfile; resolve: (ok: boolean) => void }>();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(loadUserSettings());
  }, []);

  const options = useMemo(() => engineOptionsFrom(settings), [settings]);
  const queueConfig = useMemo(() => ({ profile, uploadKey, options }), [profile, uploadKey, options]);
  const queue = useUploadQueue(queueConfig);

  const ensureTrusted = useCallback((p: BackendProfile | undefined): Promise<boolean> => {
    if (!p) return Promise.resolve(false);
    if (p.trusted) return Promise.resolve(true);
    const origin = p.apiBaseUrl ? new URL(p.apiBaseUrl).origin : "";
    if (trustedOrigins.current.has(origin)) return Promise.resolve(true);
    return new Promise((resolve) =>
      setPendingTrust({
        profile: p,
        resolve: (ok) => {
          if (ok) trustedOrigins.current.add(origin);
          setPendingTrust(undefined);
          resolve(ok);
        },
      }),
    );
  }, []);

  const guarded = useCallback(
    async (action: () => unknown) => {
      if (await ensureTrusted(profile)) await action();
    },
    [ensureTrusted, profile],
  );

  const onRetry = useCallback(
    (s: UploadSession) => {
      const p = profiles.find((x) => x.id === s.profileId);
      void ensureTrusted(p).then((ok) => {
        // Use the current key only if it belongs to the same profile; otherwise keep the session's key.
        if (ok) void s.retry(p?.id === profile?.id && uploadKey ? uploadKey : undefined);
      });
    },
    [ensureTrusted, profiles, profile, uploadKey],
  );

  const ready = queue.items.filter((i) => !i.session && i.issues.length === 0);
  const finished = queue.items.filter((i) => {
    const ph = i.session?.getSnapshot().phase;
    return ph === "completed" || ph === "canceled";
  });
  const canStart = !!profile && uploadKey.length > 0;
  const hints = profile?.hints;
  const hintText = [
    hints?.maxFileSize ? `Up to ${formatBytes(hints.maxFileSize)}` : null,
    hints?.allowedExtensions?.length ? hints.allowedExtensions.join(" ") : null,
    "Limits are enforced by your backend",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10 sm:py-14">
        <header>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-fg">
            <Upload aria-hidden className="size-5" />
            Tatar Upload
          </h1>
          <p className="mt-1.5 max-w-xl text-sm text-fg-2">
            Upload files straight to object storage with a key from your backend. The key stays in this tab; your
            backend reports processing status.
          </p>
        </header>

        <Panel
          id="destination"
          title="Destination"
          actions={
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setAddOpen(true)}>
              Add backend
            </Button>
          }
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Select
                label="Backend"
                value={profile?.id}
                onChange={(id) => {
                  if (id !== profile?.id) setUploadKey("");
                  select(id);
                }}
                options={profiles.map((p) => ({
                  key: p.id,
                  value: p.id as string | undefined,
                  label: p.name,
                  description: p.apiBaseUrl ? new URL(p.apiBaseUrl).host : p.adapter,
                }))}
              />
              {profile && (
                <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-3">
                  {profile.trusted ? (
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck aria-hidden className="size-3.5 text-ok" />
                      {profile.source === "env" ? "Configured" : "Built-in"}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-warn">
                      <ShieldAlert aria-hidden className="size-3.5" /> Custom, asks before sending your key
                    </span>
                  )}
                  <span aria-hidden>·</span>
                  <span>{profile.adapter} adapter</span>
                  {profile.source === "custom" && (
                    <>
                      <span aria-hidden>·</span>
                      <button
                        type="button"
                        onClick={() => removeProfile(profile.id)}
                        className="text-err hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </p>
              )}
              {profile?.description && <p className="mt-1.5 text-xs text-fg-3">{profile.description}</p>}
            </div>
            <UploadKeyInput value={uploadKey} onChange={setUploadKey} />
          </div>
          <div className="mt-5 border-t border-line pt-4">
            <TransferSettings
              value={settings}
              onChange={(s) => {
                setSettings(s);
                saveUserSettings(s);
              }}
            />
          </div>
        </Panel>

        <Panel
          id="files"
          title="Files"
          description={queue.items.length ? `${queue.items.length} file${queue.items.length === 1 ? "" : "s"} · ${ready.length} ready` : undefined}
        >
          <DropZone onFiles={queue.addFiles} accept={acceptAttribute(hints)} hint={hintText} />

          {queue.items.length > 0 && (
            <>
              <ul className="mt-4 divide-y divide-line border-y border-line">
                {queue.items.map((item) => (
                  <UploadItem
                    key={item.id}
                    file={item.file}
                    issues={item.issues}
                    session={item.session}
                    canStart={canStart}
                    onStart={() => void guarded(() => queue.start(item.id))}
                    onRemove={() => queue.remove(item.id)}
                    onRetry={onRetry}
                  />
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-fg-3">
                  {!uploadKey ? <span className="text-warn">Enter an upload key to start.</span> : null}
                </p>
                <div className="flex gap-2">
                  {finished.length > 0 && (
                    <Button variant="ghost" onClick={queue.clearFinished}>
                      Clear finished
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    icon={Upload}
                    disabled={!canStart || ready.length === 0}
                    onClick={() => void guarded(queue.startAll)}
                  >
                    Upload {ready.length > 1 ? `all (${ready.length})` : ""}
                  </Button>
                </div>
              </div>
            </>
          )}
        </Panel>

        <footer className="text-xs text-fg-3">
          Runs entirely in your browser. Files go directly to storage through presigned URLs.
        </footer>
      </div>

      <AddProfileDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={addProfile}
        existingIds={profiles.map((p) => p.id)}
      />
      <TrustDialog
        profile={pendingTrust?.profile}
        onConfirm={() => pendingTrust?.resolve(true)}
        onCancel={() => pendingTrust?.resolve(false)}
      />
    </>
  );
}
