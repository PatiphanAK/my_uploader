"use client";

import { Lock, Plus, ShieldCheck, ShieldAlert, Trash, Upload } from "lucide-react";
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
    "Limits are enforced by your backend",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <SiteHeader />
      <div id="top" className="mx-auto w-full max-w-4xl space-y-6 px-4 pb-16">
        <section className="pt-12 pb-2 sm:pt-16">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-elevated px-3 py-1 text-xs font-medium text-fg-2 shadow-card">
            <Lock aria-hidden className="size-3.5 text-accent" />
            Your key stays in this tab
          </span>
          <h1 className="mt-5 max-w-2xl text-4xl font-semibold tracking-tight text-balance text-fg sm:text-5xl">
            Drop files, straight to <span className="text-accent">storage</span>.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-pretty text-fg-2">
            Presigned uploads for TatarBot and other projects. Bytes go directly to object storage, and your backend
            reports processing status.
          </p>
          <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Profile" value={profile?.name ?? "—"} />
            <Stat label="Upload key" value={uploadKey ? "Set" : "Not set"} tone={uploadKey ? "ok" : "warn"} />
            <Stat label="Part size" value={`${settings.partSizeMiB} MiB × ${settings.concurrency}`} />
            <Stat label="Queue" value={`${queue.items.length} file${queue.items.length === 1 ? "" : "s"}`} />
          </dl>
        </section>

        <Panel
          id="destination"
          index="1"
          title="Destination"
          description="Pick a backend and paste the upload key it issued."
          actions={
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAddOpen(true)}>
              <span className="hidden sm:inline">Add backend</span>
              <span className="sm:hidden">Add</span>
            </Button>
          }
        >
          <div className="grid gap-5 sm:grid-cols-2">
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
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {profile.trusted ? (
                    <Badge tone="success">
                      <ShieldCheck aria-hidden className="size-3.5" /> {profile.source === "env" ? "Configured" : "Built-in"}
                    </Badge>
                  ) : (
                    <Badge tone="warning">
                      <ShieldAlert aria-hidden className="size-3.5" /> Custom · confirm before use
                    </Badge>
                  )}
                  <Badge>{profile.adapter}</Badge>
                  {profile.source === "custom" && (
                    <button
                      type="button"
                      onClick={() => removeProfile(profile.id)}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-err hover:bg-err/8 focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <Trash aria-hidden className="size-3.5" /> Remove
                    </button>
                  )}
                </div>
              )}
              {profile?.description && <p className="mt-2 text-sm leading-relaxed text-fg-3">{profile.description}</p>}
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

        <Panel id="files" index="2" title="Files" description="Add files, then upload them one by one or all at once.">
          <DropZone onFiles={queue.addFiles} accept={acceptAttribute(hints)} hint={hintText} />

          {queue.items.length > 0 && (
            <>
              <ul className="mt-5 space-y-3">
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
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <p className="text-sm text-fg-3">
                  {!uploadKey ? (
                    <span className="font-medium text-warn">Enter an upload key to start</span>
                  ) : (
                    `${queue.items.length} file${queue.items.length === 1 ? "" : "s"} · ${ready.length} ready`
                  )}
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

        <footer className="pt-2 text-center text-xs text-fg-3">
          Frontend only · bytes go directly to storage via presigned URLs · processing status comes from your backend
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded-xl border border-line bg-elevated px-4 py-3 shadow-card">
      <dt className="text-xs font-medium text-fg-3">{label}</dt>
      <dd
        className={cx(
          "mt-1 flex items-center gap-1.5 truncate text-sm font-semibold",
          tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-fg",
        )}
      >
        {tone && <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", tone === "ok" ? "bg-ok" : "bg-warn")} />}
        <span className="truncate">{value}</span>
      </dd>
    </div>
  );
}
