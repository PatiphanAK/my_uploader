"use client";

import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import { ChevronDown, Settings2 } from "lucide-react";
import { Select } from "@/components/ui/Select";
import {
  CONCURRENCY_CHOICES,
  PART_SIZE_CHOICES_MIB,
  type UserTransferSettings,
} from "@/lib/config/settings";

export function TransferSettings({
  value,
  onChange,
}: {
  value: UserTransferSettings;
  onChange: (v: UserTransferSettings) => void;
}) {
  return (
    <Disclosure>
      <DisclosureButton className="group flex items-center gap-1.5 rounded font-mono text-[11px] tracking-wider text-fg-2 uppercase transition-colors hover:text-accent-hover focus:outline-none data-focus:outline-2 data-focus:outline-accent">
        <Settings2 aria-hidden className="size-3.5" />
        transfer settings
        <span className="tracking-normal text-fg-3 normal-case">
          [{value.partSizeMiB} MiB × {value.concurrency}]
        </span>
        <ChevronDown aria-hidden className="size-3.5 transition-transform group-data-open:rotate-180" />
      </DisclosureButton>
      <DisclosurePanel className="mt-3 grid gap-3 sm:grid-cols-2">
        <Select
          label="Preferred part size"
          value={value.partSizeMiB}
          onChange={(partSizeMiB) => onChange({ ...value, partSizeMiB })}
          options={PART_SIZE_CHOICES_MIB.map((n) => ({ key: String(n), value: n, label: `${n} MiB` }))}
        />
        <Select
          label="Parallel parts"
          value={value.concurrency}
          onChange={(concurrency) => onChange({ ...value, concurrency })}
          options={CONCURRENCY_CHOICES.map((n) => ({ key: String(n), value: n, label: String(n) }))}
        />
        <p className="font-mono text-[11px] text-fg-3 sm:col-span-2">
          <span className="text-accent">#</span> the backend has the final say on part size and strategy · memory ≈ part
          size × parallel parts
        </p>
      </DisclosurePanel>
    </Disclosure>
  );
}
