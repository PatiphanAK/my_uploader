import type { UploadConstraints } from "./types";
import { formatBytes } from "../format";

export interface ValidatableFile {
  name: string;
  size: number;
  type: string;
}

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i).toLowerCase() : "";
}

function typeMatches(type: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  const t = type.toLowerCase();
  if (p === "*/*" || p === "*") return true;
  if (p.endsWith("/*")) return t.startsWith(p.slice(0, -1));
  return t === p;
}

/**
 * Client-side pre-checks. These are hints for fast feedback only — the backend
 * resolves the real restrictions from the upload key and is authoritative.
 */
export function validateFile(file: ValidatableFile, rules: UploadConstraints | undefined): string[] {
  const issues: string[] = [];
  if (!rules) return issues;
  if (rules.maxFileSize !== undefined && file.size > rules.maxFileSize) {
    issues.push(`File is ${formatBytes(file.size)}; the limit is ${formatBytes(rules.maxFileSize)}`);
  }
  const typeOk = !rules.allowedTypes?.length || rules.allowedTypes.some((p) => typeMatches(file.type, p));
  const ext = extensionOf(file.name);
  const extOk = !rules.allowedExtensions?.length || rules.allowedExtensions.some((e) => e.toLowerCase() === ext);
  // When both lists exist, matching either is enough (browsers often report empty MIME types).
  const bothListed = !!rules.allowedTypes?.length && !!rules.allowedExtensions?.length;
  if (bothListed ? !(typeOk || extOk) : !(typeOk && extOk)) {
    issues.push(`Type ${file.type || ext || "unknown"} is not allowed`);
  }
  return issues;
}

/** Build an `accept` attribute for <input type="file"> from constraints. */
export function acceptAttribute(rules: UploadConstraints | undefined): string | undefined {
  const list = [...(rules?.allowedTypes ?? []), ...(rules?.allowedExtensions ?? [])];
  return list.length ? list.join(",") : undefined;
}
