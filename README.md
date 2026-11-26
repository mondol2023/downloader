# Media Engine

Multi-platform media fetching, streaming and in-app playback. Paste a URL, pick a format, and the platform extracts it (yt-dlp + ffmpeg), renders an artifact in a background worker and streams or downloads it. It has tiered access (Guest / Free / Pro), Stripe billing, an admin console and a built-in CMS.

## Architecture

```
Browser ──► Next.js (apps/web) ──BFF──► Express API (apps/api) ──► Postgres
                 │  verifies signed                 │  ▲
                 │  stream grants                   ▼  │
                 └──────── shared secret ───── Redis / BullMQ ──► Worker (yt-dlp, ffmpeg)
```

| Path | Package | What it is |
| --- | --- | --- |
| [apps/api](apps/api) | `@media/api` | Express + Prisma API, BullMQ worker, extraction, quotas, billing, CMS, admin |
| [apps/web](apps/web) | `@media/web` | Next.js (App Router) frontend, BFF proxy, player, admin UI, CMS editor |
| [packages/shared](packages/shared) | `@media/shared` | Tier policy, media types, eligibility and stream-token code used by both apps |
| [packages/rich-text](packages/rich-text) | `@media/rich-text` | TipTap extensions, HTML renderer and sanitiser for CMS content |
| `prisma/`, `scripts/` | | Root Prisma schema/config and local DB bootstrap SQL |
| [docs/superpowers](docs/superpowers) | | Plans, specs and review notes |

## Prerequisites

- Node.js >= 20.11 and npm (workspaces)
- Docker (Postgres 16 and Redis 7 via `docker-compose.yml`)
- `yt-dlp`, `ffmpeg` and `ffprobe` on `PATH` (or set `YTDLP_PATH`, `FFMPEG_PATH`, `FFPROBE_PATH`) when running the worker outside Docker

## Quick start

```bash
npm install
cp .env.example .env          # then fill in secrets (see below)
npm run infra:up              # Postgres + Redis
npm run db:generate
npm run db:migrate
npm run db:seed               # optional
npm run dev                   # shared (watch) + api + worker + web
```

- Web: <http://localhost:3000>
- API: <http://localhost:4000>

Generate secrets with `openssl rand -hex 48` for `STREAM_SIGNING_SECRET`, `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`. `STREAM_SIGNING_SECRET` **must be identical** for the API and the web app: the API signs stream grants and Next.js verifies them.

## Scripts (repo root)

| Command | Does |
| --- | --- |
| `npm run dev` | Run shared (tsc watch), API, worker and web together |
| `npm run build` | Build shared, API and web |
| `npm run typecheck` / `npm run lint` | Run in every workspace that defines them |
| `npm run db:generate` / `db:migrate` / `db:seed` | Prisma client, migrations, seed data |
| `npm run infra:up` / `infra:down` | Start/stop Postgres and Redis |

Tests are per package: `npm test -w @media/api`, `npm test -w @media/rich-text`, `npm run e2e -w @media/web`.

## Configuration

Every variable is documented inline in [.env.example](.env.example): shared secrets, API/CORS/cookies, database and Redis, extraction binaries, storage limits and TTLs, worker concurrency, optional regional workers, Stripe, the Sheets mirror and CMS revalidation (`REVALIDATE_SECRET` must match in the API and web).

## Docker

`docker compose up` also builds the `api`, `worker` and `web` services. The worker runs extraction and transcoding in its own container with no inbound ports.

## Optional: Google Sheets ledger mirror

The API and worker can keep a read-only copy of the download log and audit trail in a Google Sheet. Postgres (plus the on-disk outbox) stays the source of truth; the sheet is a convenience view. Rows are flushed every 30 s, in batches of up to 500. `ip` and `userAgent` are never sent, and `guestKey` is replaced by a short sha256 prefix.

The feature is **off** unless both `SHEETS_SPREADSHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_FILE` are set.

1. In Google Cloud, create a service account and enable the **Google Sheets API** for the project. Create a JSON key for the account.
2. Create a spreadsheet with two tabs named exactly `download_log` and `audit_event`, then share it with the service account's email address as **Editor**. The header row is written automatically the first time a tab is empty.
3. Store the key JSON **outside the repo** (never commit it) and point `GOOGLE_SERVICE_ACCOUNT_FILE` at it. Set `SHEETS_SPREADSHEET_ID` to the id in the sheet's URL (`/spreadsheets/d/<id>/edit`).

If the Sheets API returns 429 the mirror backs off (1 s, 2 s, 4 s, 8 s; 5 tries) and then retries the rows on the next flush. Use Sheets for tabular rows only; a Google Doc is the wrong tool for data.
