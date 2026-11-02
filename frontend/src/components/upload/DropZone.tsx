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
        "group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
        over ? "border-accent bg-accent-soft" : "border-line bg-base hover:border-accent/50 hover:bg-accent-soft/50",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <span
        className={cx(
          "grid size-12 place-items-center rounded-full transition",
          over ? "bg-accent text-white" : "bg-elevated text-accent shadow-card ring-1 ring-line group-hover:ring-accent/30",
        )}
      >
        <CloudUpload aria-hidden className="size-6" />
      </span>
      <span className="text-sm text-fg-2">
        <span className="font-semibold text-accent group-hover:underline group-hover:underline-offset-4">Click to browse</span>{" "}
        or drag and drop files here
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
