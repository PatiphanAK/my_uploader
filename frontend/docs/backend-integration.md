# Backend integration — Universal Upload Protocol v1

This is the contract the built-in `standard` adapter speaks. Any backend
(TatarBot, a dataset service, a Lambda, a FastAPI app…) can accept uploads from
this frontend by implementing five JSON endpoints and handing out presigned URLs
for an S3-compatible store (S3, MinIO, R2, GCS XML API, …).

The frontend never interprets the upload key, never talks to your processing
pipeline, and never receives storage credentials.

```
 Browser                       Your API                          Object storage
 ───────                       ────────                          ──────────────
 POST /uploads  ──────────────▶ resolve key → policy
                ◀──────────── uploadId + instructions
 [multipart] POST /uploads/:id/parts ─▶ presign part URLs
                ◀──────────── URLs
 PUT/POST bytes ─────────────────────────────────────────────▶  (presigned, no key)
                ◀───────────────────────────────────────────── ETag
 POST /uploads/:id/complete ──▶ finalize, enqueue processing
                ◀──────────── state
 GET  /uploads/:id  (poll) ───▶ processing status
 DELETE /uploads/:id ─────────▶ abort (on cancel)
```

## Conventions

| | |
|---|---|
| Base URL | `apiBaseUrl` from the profile, e.g. `https://api.example.com/upload/v1` |
| Auth | `Authorization: Bearer <upload key>` on **API** calls only |
| Body | JSON (`Content-Type: application/json`) |
| Errors | non-2xx with `{ "error": { "code": "…", "message": "…" } }` — `message` is shown to the user |
| Cookies | none; requests use `credentials: "omit"` and `redirect: "error"` |

Route paths can be remapped per profile (`routes`) without writing an adapter,
e.g. `{ "initiate": "POST /v2/files", "status": "GET /v2/files/{uploadId}" }`.

### Status codes the client understands

| Status | Meaning in the UI | Client retries automatically? |
|---|---|---|
| 401 | key rejected | no (user can fix key and press Retry) |
| 403 | key lacks permission | no |
| 404 | upload not found | no |
| 408, 429, 5xx | transient | yes, exponential backoff with jitter |
| 410 | upload session / key expired | no — Retry restarts from scratch |
| 413 | file too large for this key | no (final) |
| 415 | type not allowed for this key | no (final) |

## 1. Initiate — `POST /uploads`

Request:

```jsonc
{
  "file": { "name": "handbook.pdf", "size": 73400320, "type": "application/pdf", "lastModified": 1730000000000 },
  "client": {
    "strategies": ["post", "put", "multipart"],
    "checksumAlgorithms": ["CRC32", "CRC32C", "SHA1", "SHA256"],
    "resumable": true,
    "preferredPartSize": 8388608,     // user setting; you decide
    "maxConcurrency": 4
  },
  "resumeUploadId": "up_123"          // optional: client wants to continue this upload
}
```

The backend resolves the key to destination, permissions, limits, strategy and
processing policy, then responds (`200`/`201`):

```jsonc
{
  "uploadId": "up_123",
  "expiresAt": "2026-11-02T15:00:00Z",                // optional
  "constraints": {                                     // optional, informational
    "maxFileSize": 524288000,
    "allowedTypes": ["application/pdf", "text/*"],
    "allowedExtensions": [".pdf", ".md"]
  },
  "instructions": { /* one of the three shapes below */ }
}
```

If `constraints` are returned and the file violates them, the client aborts the
upload (`DELETE`) and shows the reason. **Enforce limits server-side anyway** —
in the presigned policy (`content-length-range`) or at completion.

### Strategy: presigned POST

```json
{ "strategy": "post", "url": "https://bucket.s3.amazonaws.com/", "fields": { "key": "…", "policy": "…", "x-amz-signature": "…" }, "fileField": "file" }
```

Fields are sent in order, then the file last. Success = any 2xx.

### Strategy: presigned PUT

```json
{ "strategy": "put", "url": "https://…?X-Amz-Signature=…", "headers": { "Content-Type": "application/pdf" }, "checksum": { "algorithm": "CRC32C" } }
```

`checksum` is optional. For a single PUT, CRC checksums are streamed; SHA
checksums require reading the whole file and are capped at 128 MiB — use
multipart or CRC for larger single uploads.

### Strategy: multipart

```jsonc
{
  "strategy": "multipart",
  "partSize": 8388608,            // authoritative; last part may be smaller
  "totalParts": 9,                // optional sanity check
  "partUrlBatchSize": 8,          // optional, default 8
  "parts": [ /* optional: presigned URLs for the first parts */ ],
  "checksum": { "algorithm": "SHA256", "header": "x-amz-checksum-sha256" },  // optional
  "resumable": true,              // you can list completed parts later
  "completedParts": [ { "partNumber": 1, "etag": "\"…\"" } ]               // when resuming
}
```

Part numbers are 1-based. A zero-byte file is one empty part (prefer `put` for
small files).

## 2. Sign parts — `POST /uploads/:uploadId/parts` (multipart only)

```json
{ "parts": [ { "partNumber": 3, "size": 8388608, "checksum": "base64…" } ] }
```

→

```json
{ "parts": [ { "partNumber": 3, "url": "https://…", "headers": {}, "expiresAt": "2026-11-02T15:00:00Z" } ] }
```

- Without a checksum requirement, the client asks for URLs in batches, ahead of use.
- With a checksum requirement, the client computes each part's checksum first and
  signs that part alone, so you can bind the checksum into the signature
  (`x-amz-checksum-*` as a signed header).
- If storage returns `403 … Request has expired`, or `expiresAt` is within 30 s,
  the client re-signs that part and retries.

## 3. Storage requests (no API involvement)

- `PUT <part url>` with the raw slice as the body plus any `headers` you returned
  plus the checksum header when required.
- The client reads the `ETag` response header — **your bucket CORS must expose it**.
- `Authorization`, `Cookie` and other credential/forbidden headers are stripped
  from storage requests unless the profile sets `allowStorageAuthHeader: true`.
- The URL host must match the profile's `allowedUploadHosts`, and must be HTTPS
  (HTTP only for `localhost`).

Minimal S3/R2/MinIO CORS:

```json
[{
  "AllowedOrigins": ["https://<you>.github.io"],
  "AllowedMethods": ["PUT", "POST"],
  "AllowedHeaders": ["content-type", "x-amz-checksum-*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 600
}]
```

## 4. Complete — `POST /uploads/:uploadId/complete`

```jsonc
{
  "strategy": "multipart",
  "parts": [ { "partNumber": 1, "etag": "\"…\"", "checksum": "…", "size": 8388608 } ],  // multipart
  "etag": "\"…\"", "checksum": "…"                                                         // single uploads, if known
}
```

Make this **idempotent**: the client retries it on network errors. Respond with
an upload status (below). Return `completed` if there is no processing, or
`processing`/`uploaded` to make the client poll.

## 5. Status — `GET /uploads/:uploadId`

```jsonc
{
  "uploadId": "up_123",
  "state": "processing",          // pending | uploading | uploaded | processing | completed | failed | aborted | expired
  "processing": { "stage": "embedding", "progress": 0.42, "message": "312 / 740 chunks" },
  "result": { "documentId": "doc_9" },   // shown as JSON when completed
  "error": { "code": "parse_failed", "message": "PDF is encrypted" },
  "pollAfterMs": 2000,
  "completedParts": [ … ]                // optional, multipart while uploading
}
```

The client polls with `pollAfterMs` (or 2 s growing to 15 s) for up to 30 minutes,
then offers a manual “Refresh status”. `stage` / `message` are displayed verbatim,
so processing details (Spark job, RAG ingestion, …) stay entirely in your backend.

## 6. Abort — `DELETE /uploads/:uploadId`

Body (optional): `{ "reason": "user_canceled" | "validation_failed" }`. Abort the
multipart upload in storage and release the key's quota. Best-effort from the
client's side; also expire stale uploads server-side (S3 lifecycle rule
`AbortIncompleteMultipartUpload`).

## Resuming after a reload

When `instructions.resumable` is true, the client stores
`{ profileId, file fingerprint (name, size, lastModified), uploadId }` in
`localStorage` — **no key**. If the user re-selects the same file with a key
later, the client sends `resumeUploadId`. Respond with the *same* `uploadId`
and `completedParts` to continue, or a new upload to start over. Return `404`/`410`
if the ID is unknown or expired; the client then retries without it. Check that
the key is allowed to continue that upload.

## Security checklist for backends

- Issue short-lived, narrowly scoped upload keys; they are bearer tokens.
- Presign with short expirations (minutes) and bind content length / type / checksum where possible.
- Don't put secrets in presigned URLs beyond the signature itself.
- Validate the final object (size, type sniffing, malware scan) before processing.
- Allow CORS on the API only for the uploader's origin; no credentials needed.

## Writing a custom adapter

If a backend's JSON shapes differ, add `src/lib/upload/adapters/<name>.ts`
implementing `UploadBackendAdapter` (see `types.ts`), map its responses into the
types above, and register it in `adapters/index.ts` + `AdapterKind`. The session,
multipart engine, retry, checksum and UI code need no changes.

## Local testing

```bash
bun run mock:server                       # http://localhost:4010/api, profile "Local mock server" (dev only)
MOCK_CHECKSUM=SHA256 bun run mock:server  # require + verify per-part SHA-256
```
