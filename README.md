# Tatar Upload

A lightweight, frontend-only file uploader. Paste an upload key issued by your backend,
drop files, and the bytes go straight to object storage (S3, R2, MinIO, …) through
presigned URLs. No server of its own: it is a static site hosted on GitHub Pages.

**Live:** https://patiphanak.github.io/my_uploader/ (try the *In-browser mock* profile with the key `demo`)

## Features

- **Three upload strategies, chosen by the backend:** presigned POST, presigned PUT, and
  multipart with presigned part URLs.
- **Large files:** streamed with `File.slice()`; configurable part size and parallelism;
  automatic retries with exponential backoff.
- **Control:** pause, resume, cancel, retry, and resume after a page reload.
- **Integrity:** per-part checksums (CRC32, CRC32C, SHA-1, SHA-256).
- **Feedback:** byte-accurate progress, speed and ETA, plus processing status reported by the backend.
- **Security:**
  - The upload key lives in memory only (never in `localStorage` or the URL).
  - Storage requests carry no credentials.
  - Presigned URLs must be HTTPS and match an allowlist.
  - Backends you add yourself need confirmation before a key is sent to them.
- **Interface:** plain, minimal layout that follows the system light/dark setting; responsive down to phone width.

## Repository layout

```text
.
├── .github/workflows/deploy.yml   CI: lint, typecheck, test, build, deploy to GitHub Pages
└── frontend/                      Next.js (App Router) static-export app
    ├── src/app/                   layout, page, theme tokens (globals.css)
    ├── src/components/            UI primitives and upload components
    ├── src/hooks/                 React hooks (queue, profiles, upload state)
    ├── src/lib/upload/            upload engine: sessions, multipart, retry, checksums, adapters
    ├── scripts/mock-backend.mjs   local HTTP mock of the backend protocol
    └── docs/backend-integration.md  the API contract a backend must implement
```

## Tech stack

Next.js 16 (static export) · React 19 · TypeScript · Tailwind CSS v4 · Headless UI ·
Lucide React · Vitest · Bun

## Getting started

```bash
cd frontend
bun install
bun run dev            # http://localhost:3000
```

| Command | What it does |
|---|---|
| `bun run dev` | Dev server |
| `bun run test` | Unit and integration tests |
| `bun run lint` / `bun run typecheck` | Static checks |
| `bun run build` | Static site in `frontend/out/` |
| `bun run preview` | Serve the built site locally |
| `bun run mock:server` | Local mock backend; then choose the *Local mock server* profile in `next dev` |

### Mock keys

The in-browser mock profile accepts these keys:

| Key | Behaviour |
|---|---|
| `demo` | Uploads succeed |
| `flaky` | Random part failures that trigger retries |
| `invalid` | Rejected (401) |
| `expired` | Session expired (410) |
| `fail-processing` | Upload succeeds, then the backend reports a processing failure |

## Configuration

All settings are build-time and **public**: they end up in the JavaScript bundle, so never
put secrets in them. Copy `frontend/.env.example` to `frontend/.env.local` for local
development.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_BASE_PATH` | Sub-path the site is served from, e.g. `/my_uploader`. CI sets it automatically. |
| `NEXT_PUBLIC_UPLOAD_PROFILES` | JSON array of trusted backend profiles |
| `NEXT_PUBLIC_ENABLE_MOCK` | Set to `false` to hide the in-browser mock profile |

## Deployment

1. In **Settings → Pages**, set **Source** to **GitHub Actions** (one time only).
2. Optionally add the repository **variables** `UPLOAD_PROFILES` (JSON) and `ENABLE_MOCK`.
3. Push to `main`. The workflow tests, builds and deploys the site.

## Backend

The uploader never talks to storage on its own authority. Your backend issues upload keys,
decides the strategy and part size, signs the URLs, and finalizes the upload.
[`frontend/docs/backend-integration.md`](frontend/docs/backend-integration.md) covers the
endpoints, response shapes, error codes and CORS setup.

More detail on the app itself is in [`frontend/README.md`](frontend/README.md).
