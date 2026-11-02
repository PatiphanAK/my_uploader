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
      <DialogBackdrop transition className="fixed inset-0 bg-black/30 transition duration-150 data-closed:opacity-0" />
      <div className="fixed inset-0 flex w-screen items-end justify-center p-4 sm:items-center">
        <DialogPanel
          transition
          className="w-full max-w-md rounded-lg border border-line bg-base p-5 shadow-xl shadow-black/10 transition duration-150 ease-out data-closed:opacity-0"
        >
          <DialogTitle className="text-sm font-semibold text-fg">{title}</DialogTitle>
          {description && <Description className="mt-1 text-sm text-fg-2">{description}</Description>}
          <div className="mt-4">{children}</div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
