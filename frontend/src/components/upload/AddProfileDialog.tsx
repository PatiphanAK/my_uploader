"use client";

import { Description, Field, Input, Label } from "@headlessui/react";
import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button, fieldLabelClass, inputClass } from "@/components/ui/primitives";
import { normalizeProfile, type BackendProfile } from "@/lib/config/profiles";

export function AddProfileDialog({
  open,
  onClose,
  onAdd,
  existingIds,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (p: BackendProfile) => void;
  existingIds: string[];
}) {
  const [name, setName] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [hosts, setHosts] = useState("");
  const [error, setError] = useState<string>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    try {
      const id =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40) || "custom";
      if (existingIds.includes(id)) throw new Error(`A profile with id "${id}" already exists`);
      const profile = normalizeProfile(
        {
          id,
          name: name || id,
          adapter: "standard",
          apiBaseUrl: apiBaseUrl.trim(),
          allowedUploadHosts: hosts.split(/[\s,]+/).filter(Boolean),
        },
        "custom",
      );
      onAdd(profile);
      setName("");
      setApiBaseUrl("");
      setHosts("");
      setError(undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add backend profile"
      description="Uses the standard Universal Upload Protocol. Custom profiles are saved in this browser (no secrets) and need confirmation before a key is sent."
    >
      <form onSubmit={submit} className="space-y-4">
        <Field>
          <Label className={fieldLabelClass}>Name</Label>
          <Input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="TatarBot" required />
        </Field>
        <Field>
          <Label className={fieldLabelClass}>API base URL</Label>
          <Input
            className={inputClass}
            type="url"
            inputMode="url"
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            placeholder="https://api.example.com/upload/v1"
            required
          />
          <Description className="mt-1 text-xs text-fg-3">HTTPS only (HTTP allowed for localhost).</Description>
        </Field>
        <Field>
          <Label className={fieldLabelClass}>Allowed storage hosts</Label>
          <Input
            className={inputClass}
            value={hosts}
            onChange={(e) => setHosts(e.target.value)}
            placeholder="*.r2.cloudflarestorage.com, my-bucket.s3.amazonaws.com"
          />
          <Description className="mt-1 text-xs text-fg-3">
            Presigned URLs pointing anywhere else are refused. Defaults to the API host.
          </Description>
        </Field>
        {error && (
          <p role="alert" className="text-sm text-err">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Add profile
          </Button>
        </div>
      </form>
    </Modal>
  );
}
