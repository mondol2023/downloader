# @media/api

Express + Prisma API and BullMQ worker for Media Engine. Handles auth, format extraction, job queueing, quotas, Stripe billing, signed stream grants, the CMS and the admin console.

## Run

From the repo root, with `.env` configured and `npm run infra:up` done:

```bash
npm run dev -w @media/api          # API on API_PORT (default 4000)
npm run dev:worker -w @media/api   # queue worker (separate process)
```

| Script | Does |
| --- | --- |
| `build` / `start` | Compile with tsc / run `dist/index.js` |
| `typecheck` | `tsc --noEmit` |
| `test` / `test:watch` | Vitest (`test/**/*.test.ts`) |
| `db:generate` / `db:migrate` / `db:deploy` | Prisma client, dev migrations, production migrations |
| `db:seed` / `db:studio` | Seed data / Prisma Studio |

Extraction and rendering need `yt-dlp`, `ffmpeg` and `ffprobe` (see `YTDLP_PATH` etc. in [.env.example](../../.env.example)).

## Layout

```
src/
  index.ts        server entry
  config/         zod-validated environment (env.ts)
  routes/         auth, media, jobs, billing (mounted under /api/v1)
  services/       extraction, jobs, quota, stream grants, tokens, billing, users
  queue/          BullMQ queues, regional queues, worker entry
  middleware/     auth, errors, rate limits
  features/       admin, cms, eligibility, health, maintenance,
                  persistence (DB/outbox ledger, Sheets mirror), regions, restrictions
  lib/            logger and helpers
prisma/           schema, migrations, seed
test/             Vitest suites
```

## API surface (`/api/v1`)

`/auth`, `/media`, `/policy`, `/cms` (public content), `/jobs`, `/billing`, `/admin` (ADMIN only). Auth uses JWT access/refresh cookies. Writes are refused cleanly when Postgres is down.

## Notes

- Tier limits come from `@media/shared`; the API is the enforcing side, the frontend copy is advisory.
- CMS publish/edit POSTs to the web app's `/api/revalidate` using `WEB_INTERNAL_URL` and `REVALIDATE_SECRET`.
- New jobs are refused with `STORAGE_FULL` once `STORAGE_DIR` exceeds `STORAGE_MAX_GB`.
- Regional workers: see the `WORKER_ROLE` / `REGION` section of `.env.example`.
