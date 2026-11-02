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
      <DisclosureButton className="group flex items-center gap-2 rounded-md text-sm font-medium text-fg-2 transition-colors hover:text-fg focus:outline-none data-focus:outline-2 data-focus:outline-accent">
        <Settings2 aria-hidden className="size-4 text-fg-3" />
        Transfer settings
        <span className="font-normal text-fg-3">
          {value.partSizeMiB} MiB parts × {value.concurrency}
        </span>
        <ChevronDown aria-hidden className="size-4 text-fg-3 transition-transform group-data-open:rotate-180" />
      </DisclosureButton>
      <DisclosurePanel className="mt-4 grid gap-3 sm:grid-cols-2">
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
        <p className="text-xs text-fg-3 sm:col-span-2">
          The backend has the final say on part size and strategy. Memory use is about part size × parallel parts.
        </p>
      </DisclosurePanel>
    </Disclosure>
  );
}
