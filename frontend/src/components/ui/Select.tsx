"use client";

import { Field, Label, Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import { Check, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { cx, fieldLabelClass } from "./primitives";

export interface SelectOption<T> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  key: string;
}

export function Select<T>({
  label,
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: SelectOption<T>[];
  disabled?: boolean;
  className?: string;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <Field className={className} disabled={disabled}>
      <Label className={fieldLabelClass}>{label}</Label>
      <Listbox value={value} onChange={onChange}>
        <ListboxButton
          className={cx(
            "relative flex h-9 w-full items-center rounded-md border border-line-strong bg-base pr-8 pl-3 text-left text-sm text-fg transition-colors",
            "focus:outline-none data-focus:border-accent data-focus:ring-1 data-focus:ring-accent data-open:border-accent data-disabled:opacity-50",
          )}
        >
          <span className="truncate">{selected?.label}</span>
          <ChevronsUpDown aria-hidden className="pointer-events-none absolute right-2.5 size-4 text-fg-3" />
        </ListboxButton>
        <ListboxOptions
          anchor="bottom start"
          transition
          className={cx(
            "z-30 w-(--button-width) min-w-56 rounded-md border border-line bg-base p-1 shadow-lg shadow-black/5 [--anchor-gap:4px]",
            "focus:outline-none",
            "transition duration-100 ease-out data-closed:opacity-0",
          )}
        >
          {options.map((o) => (
            <ListboxOption
              key={o.key}
              value={o.value}
              className="group flex cursor-default items-start gap-2 rounded px-2 py-1.5 text-sm text-fg select-none data-focus:bg-sunken"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{o.label}</span>
                {o.description && <span className="block truncate text-xs text-fg-3">{o.description}</span>}
              </span>
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-fg opacity-0 group-data-selected:opacity-100" />
            </ListboxOption>
          ))}
        </ListboxOptions>
      </Listbox>
    </Field>
  );
}
