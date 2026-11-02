"use client";

import { Upload } from "lucide-react";
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
        "group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-9 text-center transition-colors",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
        over ? "border-accent bg-sunken" : "border-line-strong hover:border-fg-3 hover:bg-sunken",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <Upload aria-hidden className={cx("size-5 transition-colors", over ? "text-accent" : "text-fg-3 group-hover:text-fg")} />
      <span className="text-sm text-fg">
        Drop files here or <span className="font-medium underline underline-offset-4">browse</span>
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
