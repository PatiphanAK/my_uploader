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
import { Button, cx, ProgressBar, TONE_TEXT, type Tone } from "@/components/ui/primitives";
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
  ready: { label: "Ready", tone: "neutral" },
  idle: { label: "Ready", tone: "neutral" },
  initiating: { label: "Requesting", tone: "info" },
  uploading: { label: "Uploading", tone: "info" },
  paused: { label: "Paused", tone: "warning" },
  completing: { label: "Finalizing", tone: "info" },
  processing: { label: "Processing", tone: "info" },
  completed: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  canceled: { label: "Canceled", tone: "neutral" },
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
    <li className="py-4">
      <div className="flex items-start gap-3">
        <FileTypeIcon file={file} className="mt-0.5 size-5 shrink-0 text-fg-3" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-sm font-medium text-fg" title={file.name}>
              {file.name}
            </p>
            <span className={cx("inline-flex shrink-0 items-center gap-1 text-xs font-medium", TONE_TEXT[meta.tone])}>
              {spinning && <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />}
              {phase === "completed" && <CircleCheck aria-hidden className="size-3.5" />}
              {phase === "failed" && <CircleAlert aria-hidden className="size-3.5" />}
              <span aria-live="polite">{meta.label}</span>
            </span>
          </div>
          <p className="mt-0.5 text-xs text-fg-3">
            {formatBytes(file.size)} · {file.type || "unknown type"}
            {state?.strategy && <> · {STRATEGY_LABEL[state.strategy]}</>}
          </p>

          {issues.length > 0 && !session && (
            <ul className="mt-2 space-y-0.5 text-xs text-warn">
              {issues.map((i) => (
                <li key={i} className="flex items-center gap-1">
                  <CircleAlert aria-hidden className="size-3.5" /> {i}
                </li>
              ))}
            </ul>
          )}

          {showProgress && (
            <div className="mt-3 space-y-1.5">
              <ProgressBar
                label={`Upload progress for ${file.name}`}
                value={state.uploadedBytes}
                max={state.totalBytes || 1}
                tone={phase === "failed" ? "danger" : phase === "paused" ? "warning" : phase === "completed" ? "success" : "info"}
              />
              <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-fg-3 tabular-nums">
                <Stat label="Sent">
                  {formatBytes(state.uploadedBytes)} of {formatBytes(state.totalBytes)} ({formatPercent(state.uploadedBytes, state.totalBytes)})
                </Stat>
                {(phase === "uploading" || phase === "paused") && (
                  <>
                    <Stat label="Speed">{formatSpeed(state.speedBps)}</Stat>
                    <Stat label="ETA">{formatDuration(state.etaSeconds)}</Stat>
                  </>
                )}
                {state.partsTotal !== undefined && (
                  <Stat label="Parts">
                    {state.partsCompleted}/{state.partsTotal}
                  </Stat>
                )}
                {state.retries > 0 && <Stat label="Retries">{state.retries}</Stat>}
                {state.resumed && <Stat label="Resumed">from previous session</Stat>}
              </dl>
            </div>
          )}

          {state?.processing && (phase === "processing" || phase === "completed") && (
            <div className="mt-3 border-l-2 border-line pl-3 text-xs">
              <p className="text-fg-2">
                Backend: <span className="font-medium text-fg">{state.processing.stage ?? "processing"}</span>
                {state.processing.progress !== undefined && (
                  <span className="text-fg-3 tabular-nums"> · {Math.round(state.processing.progress * 100)}%</span>
                )}
              </p>
              {state.processing.progress !== undefined && phase === "processing" && (
                <div className="mt-1.5">
                  <ProgressBar label="Processing progress" value={state.processing.progress} size="sm" tone="neutral" />
                </div>
              )}
              {state.processing.message && <p className="mt-1 text-fg-3">{state.processing.message}</p>}
              {phase === "processing" && !state.processing.watching && (
                <p className="mt-1 text-warn">Stopped checking. Use Refresh status to check again.</p>
              )}
            </div>
          )}

          {state?.error && phase === "failed" && (
            <p role="alert" className="mt-2 text-xs text-err">
              {state.error.message} <span className="font-mono opacity-70">({state.error.code})</span>
            </p>
          )}

          {(state?.result || state?.uploadId) && (phase === "completed" || phase === "failed") && (
            <Disclosure as="div" className="mt-2">
              <DisclosureButton className="group flex items-center gap-1 rounded text-xs text-fg-3 transition-colors hover:text-fg focus:outline-none data-focus:outline-2 data-focus:outline-accent">
                Details
                <ChevronDown aria-hidden className="size-3 transition-transform group-data-open:rotate-180" />
              </DisclosureButton>
              <DisclosurePanel className="mt-1.5">
                <pre className="max-h-48 overflow-auto rounded-md border border-line bg-sunken p-3 font-mono text-[11px] leading-relaxed text-fg-2">
                  {JSON.stringify({ uploadId: state.uploadId, ...(state.result ? { result: state.result } : {}) }, null, 2)}
                </pre>
              </DisclosurePanel>
            </Disclosure>
          )}

          <div className="mt-2.5 -ml-2 flex flex-wrap gap-1">
            {!session && (
              <Button size="sm" variant="secondary" icon={Upload} disabled={!canStart || issues.length > 0} onClick={onStart} className="ml-2">
                Upload
              </Button>
            )}
            {state && canPause(state) && (
              <Button size="sm" variant="ghost" icon={Pause} onClick={() => session!.pause()}>
                Pause
              </Button>
            )}
            {state && canResume(state) && (
              <Button size="sm" variant="ghost" icon={Play} onClick={() => void session!.resume()}>
                Resume
              </Button>
            )}
            {state && canRetry(state) && (
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => onRetry(session!)}>
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
    <div className="flex gap-1">
      <dt>{label}</dt>
      <dd className="text-fg-2">{children}</dd>
    </div>
  );
}
