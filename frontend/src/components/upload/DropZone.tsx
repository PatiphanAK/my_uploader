"use client";

import { CloudUpload } from "lucide-react";
import { useId, useRef, useState, type DragEvent } from "react";
import { cx } from "@/components/ui/primitives";

export function DropZone({
  onFiles,
  accept,
  hint,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    if (disabled) return;
    const files = [...e.dataTransfer.files].filter((f) => f.size > 0 || f.type !== "");
    if (files.length) onFiles(files);
  };

  return (
    <label
      htmlFor={id}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={onDrop}
      className={cx(
        "group relative flex cursor-pointer flex-col items-center justify-center gap-2.5 overflow-hidden rounded-lg border border-dashed px-6 py-10 text-center transition",
        "bg-sunken/60 bg-[linear-gradient(var(--grid)_1px,transparent_1px),linear-gradient(90deg,var(--grid)_1px,transparent_1px)] bg-size-[16px_16px]",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
        over ? "border-accent shadow-glow-strong" : "border-line hover:border-accent/70 hover:shadow-glow",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <span
        className={cx(
          "grid size-12 place-items-center rounded-md border transition",
          over ? "border-accent bg-accent/15 text-accent-hover" : "border-line-muted bg-elevated text-fg-3 group-hover:text-accent",
        )}
      >
        <CloudUpload aria-hidden className="size-6" />
      </span>
      <span className="font-mono text-sm text-fg">
        <span className="text-accent">$</span> drop files here <span className="text-fg-3">or</span>{" "}
        <span className="text-accent-hover underline decoration-accent/40 underline-offset-4 group-hover:decoration-accent">
          browse
        </span>
      </span>
      {hint && <span className="text-xs text-fg-3">{hint}</span>}
      <input
        id={id}
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) onFiles(files);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />
    </label>
  );
}
