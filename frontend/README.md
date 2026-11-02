# Tatar Upload

A small, frontend-only file uploader for personal projects (TatarBot RAG
ingestion, datasets, build artifacts, …). Paste an upload key issued by your
backend, drop files, and bytes go straight to object storage via presigned URLs.

- Next.js (App Router) static export → GitHub Pages. No server, API routes, or middleware.
- Presigned **POST**, presigned **PUT**, and **multipart** with presigned part URLs — the backend picks.
- `File.slice()` streaming, configurable part size and concurrency, exponential backoff with jitter,
  pause/resume, cancel, retry, resume after reload, per-part CRC32/CRC32C/SHA-1/SHA-256 checksums.
- Byte-accurate progress, speed and ETA; backend-reported processing status.
- Tailwind CSS + Headless UI; responsive; plain minimal design that follows the system light/dark setting. Colors live as tokens in `src/app/globals.css`.

## Quick start

```bash
bun install          # or npm install
bun run dev          # http://localhost:3000 — try the "In-browser mock" profile with key "demo"
bun run test         # unit + integration tests
bun run build        # static site in out/
```

Mock keys: `demo` (works), `flaky` (random part failures → retries), `invalid` (401),
`expired` (410), `fail-processing` (backend reports failure).

To exercise the real HTTP adapter: `bun run mock:server`, then pick
**Local mock server** (only listed in `next dev`).

## Configuration

All configuration is build-time and public (it ends up in the JS bundle).

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_BASE_PATH` | Sub-path, e.g. `/universal-upload` for project pages. CI sets it automatically. |
| `NEXT_PUBLIC_UPLOAD_PROFILES` | JSON array of **trusted** backend profiles (see below). |
| `NEXT_PUBLIC_ENABLE_MOCK` | `false` hides the in-browser mock profile. |

Profile:

```json
{
  "id": "tatarbot",
  "name": "TatarBot",
  "apiBaseUrl": "https://api.tatarbot.example/upload/v1",
  "allowedUploadHosts": ["*.r2.cloudflarestorage.com"],
  "hints": { "maxFileSize": 524288000, "allowedExtensions": [".pdf", ".md"] },
  "routes": { "initiate": "POST /uploads" }
}
```

Profiles can also be added in the UI. Those are saved in `localStorage` (no secrets),
marked untrusted, and require a confirmation per session before a key is sent.

## Deploying to GitHub Pages

1. Push to `main`. In **Settings → Pages**, set *Source* to **GitHub Actions**.
2. Optionally add repository **variables** `UPLOAD_PROFILES` (JSON) and `ENABLE_MOCK`.
3. `.github/workflows/deploy.yml` (at the repo root) runs in `frontend/`: lints, type-checks, tests, builds `frontend/out/`, and deploys.

## Security model

- The upload key is held in React state only: never persisted, never in a URL, and
  only sent as `Authorization: Bearer` to the profile's API origin.
- Storage requests carry no credentials: credential headers are stripped and
  `withCredentials` is off. Presigned URLs must be HTTPS and match the profile's
  `allowedUploadHosts`.
- API base URLs must be HTTPS (HTTP allowed for loopback only); redirects are refused.
- `localStorage` holds only custom profiles, transfer settings and resume records
  (`profileId`, file fingerprint, `uploadId`).
- `<meta name="referrer" content="no-referrer">` keeps the page URL from leaking.

## Layout

```text
src/
├── app/                     layout, page, globals.css
├── components/
│   ├── ui/                  Button, Panel, Badge, ProgressBar, Select (Listbox), Modal (Dialog)
│   └── upload/              Uploader, DropZone, UploadItem, UploadKeyInput, profile dialogs, settings
├── hooks/                   useProfiles, useUploadQueue, useUploadState
└── lib/
    ├── config/              profiles (env/custom/builtin), transfer settings
    ├── format.ts
    └── upload/
        ├── types.ts         protocol + adapter + transport interfaces
        ├── contract.ts      runtime validation of backend responses
        ├── session.ts       UploadSession: initiate → transfer → complete → poll
        ├── state.ts         pure reducer + selectors (UI state machine)
        ├── multipart.ts     part planning, URL batching, concurrent part uploads
        ├── single.ts        presigned PUT / POST
        ├── checksum.ts      CRC32, CRC32C (streaming), SHA-1/256 (WebCrypto)
        ├── retry.ts         exponential backoff with full jitter, abortable sleep
        ├── progress.ts      byte-accurate progress, speed, ETA
        ├── destination.ts   URL + header guards
        ├── resume.ts        secret-free resume records
        ├── http.ts          XHR transport (upload progress)
        └── adapters/        standard (HTTP protocol), mock (in-browser)
scripts/mock-backend.mjs     local HTTP mock of the protocol (dev only)
docs/backend-integration.md  the backend contract
```

## Assumptions

- Storage is S3-compatible for multipart (ETag per part, 1-based part numbers, ≥5 MiB parts except the last — the backend picks the size).
- The backend is the authority on limits, strategy and part size; client checks are hints.
- One file uploads at a time from the queue (parts within a file run in parallel). This keeps memory at about part size × concurrency.
- Processing (parsing, chunking, embeddings, Spark, queues) is backend-only; the UI only shows reported `stage`, `progress` and `message`.
- `complete` is idempotent on the backend, because the client retries it.
