"use client";

import { Description, Field, Input, Label } from "@headlessui/react";
import { Eye, EyeOff, KeyRound, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { cx, fieldLabelClass, inputClass } from "@/components/ui/primitives";

const iconButton =
  "rounded-md p-1.5 text-fg-3 transition-colors hover:bg-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-accent";

export function UploadKeyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <Field>
      <Label className={fieldLabelClass}>Upload key</Label>
      <div className="relative">
        <KeyRound aria-hidden className="pointer-events-none absolute top-3 left-3 size-4 text-fg-3" />
        <Input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          autoComplete="off"
          spellCheck={false}
          // Not a login password; keep password managers from saving it.
          data-1p-ignore
          data-lpignore="true"
          placeholder="Paste the key from your backend"
          className={cx(inputClass, "pr-16 pl-9 font-mono placeholder:font-sans")}
        />
        <div className="absolute inset-y-0 right-1 flex items-center">
          {value && (
            <button type="button" onClick={() => onChange("")} className={iconButton} aria-label="Clear upload key">
              <X className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className={iconButton}
            aria-label={visible ? "Hide upload key" : "Show upload key"}
            aria-pressed={visible}
          >
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>
      <Description className="mt-2 flex items-center gap-1.5 text-xs text-fg-3">
        <ShieldCheck aria-hidden className="size-3.5 shrink-0 text-ok" />
        Kept in memory only. Never saved, never put in a URL, never sent to storage.
      </Description>
    </Field>
  );
}
