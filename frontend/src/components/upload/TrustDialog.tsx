"use client";

import { ShieldAlert } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import type { BackendProfile } from "@/lib/config/profiles";

/** Confirmation before an upload key is sent to a user-added (untrusted) backend. */
export function TrustDialog({
  profile,
  onConfirm,
  onCancel,
}: {
  profile: BackendProfile | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const origin = profile?.apiBaseUrl ? new URL(profile.apiBaseUrl).origin : "";
  return (
    <Modal
      open={!!profile}
      onClose={onCancel}
      title={
        <span className="flex items-center gap-2">
          <ShieldAlert aria-hidden className="size-5 text-warn" />
          Send upload key to this backend?
        </span>
      }
      description="This profile was added in the browser, not configured at build time. Only continue if you trust it."
    >
      <dl className="space-y-3 rounded-md border border-line-muted bg-sunken p-3 text-sm">
        <div>
          <dt className="label-mono text-[10px]">API origin (receives your key)</dt>
          <dd className="mt-1 font-mono text-[13px] break-all text-accent-hover">{origin}</dd>
        </div>
        <div>
          <dt className="label-mono text-[10px]">Allowed storage hosts (receive file bytes, never the key)</dt>
          <dd className="mt-1 font-mono text-[13px] break-all text-accent-hover">
            {profile?.allowedUploadHosts?.join(", ")}
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onConfirm} autoFocus>
          Trust for this session
        </Button>
      </div>
    </Modal>
  );
}
