"use client";

import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  File as FileIcon,
  FileArchive,
  FileCode,
  FileImage,
  FileText,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Trash,
  Upload,
  X,
} from "lucide-react";
import { Badge, Button, cx, ProgressBar, type Tone } from "@/components/ui/primitives";
import { useUploadState } from "@/hooks/useUploadState";
import { formatBytes, formatDuration, formatPercent, formatSpeed } from "@/lib/format";
import type { UploadSession } from "@/lib/upload/session";
import { canCancel, canPause, canResume, canRetry, isActive, type UploadPhase } from "@/lib/upload/state";

function FileTypeIcon({ file, className }: { file: File; className: string }) {
  const t = file.type;
  const n = file.name.toLowerCase();
  if (t.startsWith("image/")) return <FileImage aria-hidden className={className} />;
  if (/\.(zip|tar|gz|tgz|7z|rar|zst|parquet)$/.test(n)) return <FileArchive aria-hidden className={className} />;
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|json|ya?ml|toml|sh|sql|ipynb)$/.test(n)) return <FileCode aria-hidden className={className} />;
  if (t.startsWith("text/") || /\.(pdf|md|docx?|csv|txt)$/.test(n)) return <FileText aria-hidden className={className} />;
  return <FileIcon aria-hidden className={className} />;
}

const PHASE: Record<UploadPhase | "ready", { label: string; tone: Tone }> = {
  ready: { label: "ready", tone: "neutral" },
  idle: { label: "ready", tone: "neutral" },
  initiating: { label: "requesting", tone: "info" },
  uploading: { label: "uploading", tone: "info" },
  paused: { label: "paused", tone: "warning" },
  completing: { label: "finalizing", tone: "info" },
  processing: { label: "processing", tone: "info" },
  completed: { label: "done", tone: "success" },
  failed: { label: "failed", tone: "danger" },
  canceled: { label: "canceled", tone: "neutral" },
};

const STRATEGY_LABEL = { post: "presigned POST", put: "presigned PUT", multipart: "multipart" } as const;

export function UploadItem({
  file,
  issues,
  session,
  canStart,
  onStart,
  onRemove,
  onRetry,
}: {
  file: File;
  issues: string[];
  session?: UploadSession;
  canStart: boolean;
  onStart: () => void;
  onRemove: () => void;
  onRetry: (s: UploadSession) => void;
}) {
  const state = useUploadState(session);
  const phase = state?.phase ?? "ready";
  const meta = PHASE[phase];
  const busy = state ? isActive(state) || phase === "processing" : false;
  const showProgress = state && phase !== "idle" && phase !== "canceled";
  const spinning =
    phase === "initiating" || phase === "completing" || (phase === "processing" && !!state?.processing?.watching);

  return (
    <li
      className={cx(
        "rounded-lg border bg-elevated p-3 transition sm:p-4",
        phase === "uploading" ? "border-accent/50 shadow-glow" : "border-line-muted hover:border-line",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-line-muted bg-sunken">
          <FileTypeIcon file={file} className="size-4.5 text-accent" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="truncate font-mono text-sm font-semibold text-fg" title={file.name}>
              {file.name}
            </p>
            <Badge tone={meta.tone}>
              {spinning && <LoaderCircle aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />}
              {phase === "completed" && <CircleCheck aria-hidden className="size-3" />}
              {phase === "failed" && <CircleAlert aria-hidden className="size-3" />}
              <span aria-live="polite">{meta.label}</span>
            </Badge>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge>{formatBytes(file.size)}</Badge>
            <Badge>{file.type || "unknown type"}</Badge>
            {state?.strategy && <Badge tone="info">{STRATEGY_LABEL[state.strategy]}</Badge>}
            <span className="font-mono text-[11px] text-fg-3">modified {new Date(file.lastModified).toLocaleString()}</span>
          </div>

          {issues.length > 0 && !session && (
            <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-warn">
              {issues.map((i) => (
                <li key={i} className="flex items-center gap-1">
                  <CircleAlert aria-hidden className="size-3.5" /> {i}
                </li>
              ))}
            </ul>
          )}

          {showProgress && (
            <div className="mt-3 space-y-2">
              <ProgressBar
                label={`Upload progress for ${file.name}`}
                value={state.uploadedBytes}
                max={state.totalBytes || 1}
                tone={phase === "failed" ? "danger" : phase === "paused" ? "warning" : phase === "completed" ? "success" : "info"}
              />
              <dl className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] text-fg-2 tabular-nums">
                <Stat label="sent">
                  {formatBytes(state.uploadedBytes)} / {formatBytes(state.totalBytes)}{" "}
                  <span className="text-accent-hover">{formatPercent(state.uploadedBytes, state.totalBytes)}</span>
                </Stat>
                {(phase === "uploading" || phase === "paused") && (
                  <>
                    <Stat label="speed">{formatSpeed(state.speedBps)}</Stat>
                    <Stat label="eta">{formatDuration(state.etaSeconds)}</Stat>
                  </>
                )}
                {state.partsTotal !== undefined && (
                  <Stat label="parts">
                    {state.partsCompleted}/{state.partsTotal}
                  </Stat>
                )}
                {state.retries > 0 && <Stat label="retries">{state.retries}</Stat>}
                {state.resumed && <Stat label="resumed">previous session</Stat>}
              </dl>
            </div>
          )}

          {state?.processing && (phase === "processing" || phase === "completed") && (
            <div className="mt-3 rounded-md border border-line-muted bg-sunken p-2.5 font-mono text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-fg-2">
                  <span className="text-fg-3">backend ›</span> <span className="text-violet">{state.processing.stage ?? "processing"}</span>
                </span>
                {state.processing.progress !== undefined && (
                  <span className="text-fg-3 tabular-nums">{Math.round(state.processing.progress * 100)}%</span>
                )}
              </div>
              {state.processing.progress !== undefined && phase === "processing" && (
                <div className="mt-2">
                  <ProgressBar label="Processing progress" value={state.processing.progress} size="sm" tone="info" />
                </div>
              )}
              {state.processing.message && <p className="mt-1.5 text-fg-3">{state.processing.message}</p>}
              {phase === "processing" && !state.processing.watching && (
                <p className="mt-1.5 text-warn">stopped polling · refresh to check again</p>
              )}
            </div>
          )}

          {state?.error && phase === "failed" && (
            <p role="alert" className="mt-2 rounded-md border border-err/30 bg-err/5 px-2.5 py-1.5 font-mono text-[11px] text-err">
              <span className="text-err/70">error[{state.error.code}]</span> {state.error.message}
            </p>
          )}

          {(state?.result || state?.uploadId) && (phase === "completed" || phase === "failed") && (
            <Disclosure as="div" className="mt-2.5">
              <DisclosureButton className="group flex items-center gap-1 font-mono text-[11px] text-fg-3 transition-colors hover:text-accent-hover focus:outline-none data-focus:underline">
                ./details
                <ChevronDown aria-hidden className="size-3 transition-transform group-data-open:rotate-180" />
              </DisclosureButton>
              <DisclosurePanel className="mt-1.5 overflow-hidden rounded-md border border-line-muted bg-sunken font-mono text-[11px] leading-relaxed">
                <p className="border-b border-line-muted px-2.5 py-1.5">
                  <span className="text-term-user">tatar@upload</span>
                  <span className="text-fg-3">:~$</span> <span className="text-fg">cat result.json</span>
                </p>
                <pre className="max-h-48 overflow-auto px-2.5 py-2 text-ok">
                  {JSON.stringify({ uploadId: state.uploadId, ...(state.result ? { result: state.result } : {}) }, null, 2)}
                </pre>
              </DisclosurePanel>
            </Disclosure>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {!session && (
              <Button size="sm" variant="primary" icon={Upload} disabled={!canStart || issues.length > 0} onClick={onStart}>
                Upload
              </Button>
            )}
            {state && canPause(state) && (
              <Button size="sm" icon={Pause} onClick={() => session!.pause()}>
                Pause
              </Button>
            )}
            {state && canResume(state) && (
              <Button size="sm" variant="primary" icon={Play} onClick={() => void session!.resume()}>
                Resume
              </Button>
            )}
            {state && canRetry(state) && (
              <Button size="sm" variant="primary" icon={RotateCcw} onClick={() => onRetry(session!)}>
                {phase === "processing" ? "Refresh status" : "Retry"}
              </Button>
            )}
            {state && canCancel(state) && (
              <Button size="sm" variant="danger" icon={X} onClick={() => void session!.cancel()}>
                Cancel
              </Button>
            )}
            {!busy && (
              <Button size="sm" variant="ghost" icon={Trash} onClick={onRemove} aria-label={`Remove ${file.name}`}>
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-fg-3">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
