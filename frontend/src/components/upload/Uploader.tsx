"use client";

import { Plus, ShieldCheck, ShieldAlert, Trash, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Select } from "@/components/ui/Select";
import { SiteHeader } from "@/components/ui/SiteHeader";
import { Badge, Button, cx, Panel } from "@/components/ui/primitives";
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
    "Limits are enforced by the backend for your key",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <SiteHeader />
      <div id="top" className="mx-auto w-full max-w-4xl space-y-5 px-4 pb-16">
        <section className="grid gap-8 pt-10 pb-4 sm:pt-14 md:grid-cols-[1fr_17rem] md:items-end">
          <div>
            <p className="label-mono">./upload</p>
            <h1 className="mt-4 font-mono text-3xl leading-[1.15] font-bold tracking-tight text-fg sm:text-[2.5rem]">
              Drop files,
              <br />
              straight to <span className="text-accent">storage.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-fg-2">
              Presigned uploads for TatarBot and other projects. Your key stays in memory; bytes go directly to
              object storage, and your backend reports processing status.
            </p>
          </div>
          <div className="border-line-muted text-sm md:border-l md:pl-5">
            <p className="label-mono mb-3">session</p>
            <dl className="space-y-2">
            <StatusRow label="profile" value={profile?.name ?? "—"} />
            <StatusRow label="key" value={uploadKey ? "set · in memory" : "not set"} tone={uploadKey ? "ok" : "warn"} />
            <StatusRow label="parts" value={`${settings.partSizeMiB} MiB × ${settings.concurrency}`} />
            <StatusRow label="queue" value={`${queue.items.length} file${queue.items.length === 1 ? "" : "s"}`} />
            </dl>
          </div>
        </section>

        <Panel
          id="destination"
          index="01"
          title="destination"
          actions={
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setAddOpen(true)}>
              Add backend
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Select
                label="Backend profile"
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
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {profile.trusted ? (
                    <Badge tone="success">
                      <ShieldCheck aria-hidden className="size-3" /> {profile.source === "env" ? "configured" : "built-in"}
                    </Badge>
                  ) : (
                    <Badge tone="warning">
                      <ShieldAlert aria-hidden className="size-3" /> custom · confirm before use
                    </Badge>
                  )}
                  <Badge>{profile.adapter}</Badge>
                  {profile.source === "custom" && (
                    <button
                      type="button"
                      onClick={() => removeProfile(profile.id)}
                      className="inline-flex items-center gap-1 rounded px-1 font-mono text-[11px] text-err/90 hover:text-err hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <Trash aria-hidden className="size-3" /> remove
                    </button>
                  )}
                </div>
              )}
              {profile?.description && <p className="mt-2 text-xs leading-relaxed text-fg-3">{profile.description}</p>}
            </div>
            <UploadKeyInput value={uploadKey} onChange={setUploadKey} />
          </div>
          <div className="mt-4 border-t border-line-muted pt-3">
            <TransferSettings
              value={settings}
              onChange={(s) => {
                setSettings(s);
                saveUserSettings(s);
              }}
            />
          </div>
        </Panel>

        <Panel id="files" index="02" title="files">
          <DropZone onFiles={queue.addFiles} accept={acceptAttribute(hints)} hint={hintText} />

          {queue.items.length > 0 && (
            <>
              <p className="mt-5 mb-2 font-mono text-[11px] text-fg-3">
                {queue.items.length} file{queue.items.length === 1 ? "" : "s"} queued
              </p>
              <ul className="space-y-3">
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
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line-muted pt-4">
                <p className="font-mono text-[11px] text-fg-3">
                  {!uploadKey ? (
                    <span className="text-warn">› enter an upload key to start</span>
                  ) : (
                    `› ${ready.length} ready`
                  )}
                </p>
                <div className="flex gap-2">
                  {finished.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={queue.clearFinished}>
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

        <footer className="pt-4 text-center font-mono text-[11px] text-fg-3">
          frontend only <span className="text-accent/60">·</span> bytes go directly to storage via presigned URLs{" "}
          <span className="text-accent/60">·</span> processing status is reported by your backend
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

function StatusRow({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-baseline gap-3">
      <dt className="text-right font-mono text-xs text-fg">{label}</dt>
      <dd
        className={cx(
          "truncate border-l border-line-muted pl-3 text-[13px]",
          tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-fg-2",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
