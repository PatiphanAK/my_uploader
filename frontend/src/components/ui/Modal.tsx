"use client";

import { Description, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import type { ReactNode } from "react";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-zinc-950/25 backdrop-blur-[2px] transition duration-150 data-closed:opacity-0"
      />
      <div className="fixed inset-0 flex w-screen items-end justify-center p-4 sm:items-center">
        <DialogPanel
          transition
          className="w-full max-w-md rounded-2xl border border-line bg-elevated p-6 shadow-pop transition duration-150 ease-out data-closed:translate-y-2 data-closed:scale-[0.98] data-closed:opacity-0"
        >
          <DialogTitle className="text-base font-semibold text-fg">{title}</DialogTitle>
          {description && <Description className="mt-1.5 text-sm leading-relaxed text-fg-2">{description}</Description>}
          <div className="mt-5">{children}</div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
