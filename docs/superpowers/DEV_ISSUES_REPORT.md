# `npm run dev` Issues Report

**Date:** 2026-11-25
**Project:** media-engine (npm workspaces monorepo)
**Environment:** Windows 11, Node v24.22.1, npm 11.19.1

## Summary

`npm run dev` starts three processes (`api`, `worker`, `web`). All three fail, each for a different reason:

| # | Process | Error | Root cause | Severity |
|---|---------|-------|-----------|----------|
| 1 | web | `No workspaces found: --workspace=@media/web` | The `apps/web` folder does not exist | Blocker |
| 2 | api | `Invalid environment configuration … Required` | The root `.env` file is never loaded | Blocker |
| 3 | worker | `Cannot find module …\@media\shared\dist\index.js` | `packages/shared` was never built | Blocker |
| 4 | api + worker | Prisma `P1000: Authentication failed` (shows up after 2 and 3 are fixed) | The `media` user/database in `.env` doesn't exist on your local Postgres 18 | Blocker |
| 5 | — | Typecheck failures (TS2305, TS2339 …) | The Prisma client was never generated | High |
| 6 | — | 2 real TypeScript errors | Code bugs (see below) | Medium |
| 7 | worker jobs | `yt-dlp`, `ffmpeg` and `ffprobe` are not installed | Missing system tools | High (at runtime) |
| 8 | — | Files the project refers to are missing | Incomplete repo | Medium |

---

## 1. `[web] No workspaces found: --workspace=@media/web`

The root `package.json` declares the workspaces `packages/*` and `apps/*`. Only these exist:

```
apps/api         -> @media/api
packages/shared  -> @media/shared
```

There is **no `apps/web`**, but the `dev` script still runs `npm run dev -w @media/web`. The repo was committed without the Next.js frontend. `docker-compose.yml` (the `web` service, `apps/web/Dockerfile`) and `.env` (`API_INTERNAL_URL`, `NEXT_PUBLIC_*`) also expect it.

**Fix:**
- Add the missing `apps/web` Next.js app (with `"name": "@media/web"` in its `package.json`), **or**
- Until then, remove the web part from the `dev` script in the root `package.json`:
  ```json
  "dev": "concurrently -n api,worker -c blue,magenta \"npm run dev -w @media/api\" \"npm run dev:worker -w @media/api\""
  ```
  The root `build` script (`npm run build -w @media/web`) fails for the same reason.

## 2. `[api] Invalid environment configuration: DATABASE_URL: Required …`

`.env` is in the **repo root** and contains every required variable. However:

- Nothing in the code loads it. There is no `dotenv` and no `--env-file`. [apps/api/src/config/env.ts](apps/api/src/config/env.ts) reads `process.env` directly.
- `npm run dev -w @media/api` runs `tsx watch src/index.ts` with the working directory set to `apps/api`, so even tools that look for a `.env` "next to" the process don't find one.

**Verified:** when I started the API with the env file loaded (`node --env-file=../../.env --import tsx src/index.ts`), it booted and logged `Media engine API listening, port 4000`.

**Fix:** load the root env file in [apps/api/package.json](apps/api/package.json) (tsx passes `--env-file` through to Node, which has supported it natively since v20.6):

```json
"dev": "tsx watch --env-file=../../.env src/index.ts",
"dev:worker": "tsx watch --env-file=../../.env src/queue/worker.ts",
"db:seed": "tsx --env-file=../../.env prisma/seed.ts",
"start": "node --env-file=../../.env dist/index.js",
"start:worker": "node --env-file=../../.env dist/queue/worker.js"
```

**Prisma CLI note:** `prisma migrate` / `prisma studio` run from `apps/api` will **not** see the root `.env` either. Pick one of:
- copy or symlink `.env` into `apps/api/`, or
- install `dotenv-cli` and use `dotenv -e ../../.env -- prisma migrate dev`.

Also, the API process appears to stay alive after the env error. That's because `tsx watch` keeps watching for changes after the child process exits. It isn't a separate bug.

## 3. `[worker] Cannot find module '…\node_modules\@media\shared\dist\index.js'`

[packages/shared/package.json](packages/shared/package.json) points `main`, `types` and `exports` at `./dist/…`. `dist/` is gitignored and is only created by `npm run build -w @media/shared`, which nobody had run.

The API process fails on the env check first. The worker fails here instead because [worker.ts](apps/api/src/queue/worker.ts) imports `@media/shared` *before* `../config/env.js`. Once the shared package is built, the worker hits issue 2 as well.

**Fix (either):**
- One-off: `npm run build -w @media/shared`, and re-run it every time `packages/shared` changes.
- Better for dev: run the shared package's watcher alongside the others by adding `"npm run dev -w @media/shared"` (it runs `tsc --watch`) to the root `dev` script. Or add a `"predev": "npm run build -w @media/shared"` script at the root.

> I already ran `npm run build -w @media/shared` while investigating, so `packages/shared/dist` exists now. It's gitignored.

## 4. Database authentication failure (the next error you'll hit)

With the env loaded and shared built, the worker gets this far and then fails:

```
Invalid `prisma.job.findMany()` invocation … worker.ts:625
Authentication failed against database server, the provided database credentials for `media` are not valid.
```

- `.env` points at `postgresql://media:***@localhost:5432/media_engine`. Those are the credentials from the **Docker** Postgres in `docker-compose.yml`.
- **Docker is not installed** on this machine, so `npm run infra:up` can't work.
- Instead, a native **`postgresql-x64-18`** Windows service is running on port 5432, and **Memurai** (a Redis-compatible server) is running on port 6379. Both ports are open.
- The native Postgres has no `media` role or `media_engine` database (Prisma error P1000).
- There is **no `apps/api/prisma/migrations/` folder**, so the tables don't exist yet either.

**Fix:**
1. Create the role and database in your local Postgres (with psql or pgAdmin, as the `postgres` superuser):
   ```sql
   CREATE ROLE media WITH LOGIN PASSWORD 'media';
   CREATE DATABASE media_engine OWNER media;
   ```
   Or change `DATABASE_URL` in `.env` to a user that already exists.
2. Create the tables: `npm run db:migrate` (once Prisma can see the env, see issue 2).
3. Redis via Memurai on port 6379 matches `REDIS_URL` and should work as-is.

## 5. Prisma client not generated

`node_modules/.prisma/client` only had Prisma's placeholder client, so typechecking failed with about 15 errors such as:

```
Module '"@prisma/client"' has no exported member 'Job' / 'JobState' / 'Tier' / 'User' …
Property 'PrismaClientKnownRequestError' does not exist on type 'typeof Prisma'
```

**Fix:** `npm run db:generate` (= `prisma generate`). Run it after every `npm install` and after every edit to `schema.prisma`. A `"postinstall": "prisma generate"` script in `apps/api/package.json` would automate this.

> I already ran `prisma generate` while investigating. Those errors are gone.

## 6. Real TypeScript errors (left after steps 3 and 5)

`npx tsc -p apps/api/tsconfig.json --noEmit` still reports 2 errors. `tsx` doesn't typecheck, so they don't stop `npm run dev`, but they will fail `npm run build` and `npm run typecheck`.

### 6a. [apps/api/src/lib/exec.ts:64-66](apps/api/src/lib/exec.ts#L64-L66)
```
TS2322: Type 'ChildProcessByStdio<null, Readable, Readable>' is not assignable to type 'ChildProcessWithoutNullStreams'.
```
`spawn` is called with `stdio: ['ignore', 'pipe', 'pipe']`, so `stdin` is `null`. The variable is declared with a type that assumes all three streams exist.

**Fix:**
```ts
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
let child: ChildProcessByStdio<null, Readable, Readable>;
```

### 6b. [apps/api/src/lib/stripe.ts:21](apps/api/src/lib/stripe.ts#L21)
```
TS2322: Type '"2024-12-18.acacia"' is not assignable to type '"2025-02-24.acacia"'.
```
`stripe` is declared as `^17.5.0`, but **17.7.0** got installed, and that version only accepts `'2025-02-24.acacia'` as its API version type.

**Fix (pick one):**
- Pin the SDK so the code and the webhook payload shapes stay in sync: `"stripe": "17.5.0"`, **or**
- Update to `apiVersion: '2025-02-24.acacia'` and recheck the webhook handling against Stripe's changelog.

## 7. Missing system tools: `yt-dlp`, `ffmpeg`, `ffprobe`

None of the three is on `PATH`. The worker boots without them, but every extraction or transcode job will fail when it calls `spawn`.

**Fix:** install them, for example with `winget install yt-dlp.yt-dlp Gyan.FFmpeg`. Or set `YTDLP_PATH`, `FFMPEG_PATH` and `FFPROBE_PATH` in `.env` to their full paths.

## 8. Missing files and other warnings

| Item | Referenced by | Status |
|------|---------------|--------|
| `apps/web/` | root `dev` and `build` scripts, `docker-compose.yml` | Missing |
| `apps/api/prisma/seed.ts` | `db:seed` script and `package.json#prisma.seed` | Missing, so `npm run db:seed` will fail |
| `apps/api/prisma/migrations/` | `db:deploy` | Missing, so run `db:migrate` to create it |
| `apps/api/Dockerfile`, `apps/web/Dockerfile` | `docker-compose.yml` | Missing, so `docker compose up` fails for `api`, `worker` and `web` |
| `package-lock.json` | — | Not committed (shows as untracked in git). Commit it so installs are reproducible. |

- **Prisma deprecation warning:** the `"prisma"` key in `apps/api/package.json` is deprecated and will be removed in Prisma 7. Move it to a `prisma.config.ts` file.
- **Placeholder secrets:** `.env` is an exact copy of `.env.example`. `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `STREAM_SIGNING_SECRET` still hold the example placeholder values. That's fine for local dev, but `env.ts` refuses to boot in `production` with them. Generate real ones with `openssl rand -hex 48`.
- **Terminal behaviour (not a project bug):** typing `y` after `Terminate batch job (Y/N)?` gave `The term 'y' is not recognized`. The Ctrl+C had already ended the batch job and PowerShell was back at its own prompt, so it read `y` as a command. Pressing Ctrl+C once more, or just ignoring the prompt, is enough.

---

## Fix order checklist

1. [ ] `npm install` (already done)
2. [ ] `npm run build -w @media/shared` (done during investigation; redo after changing `packages/shared`)
3. [ ] `npm run db:generate` (done during investigation)
4. [ ] Add `--env-file=../../.env` to the `apps/api` scripts (issue 2)
5. [ ] Remove `@media/web` from the root `dev` script, or add the `apps/web` app (issue 1)
6. [ ] Create the `media` role and `media_engine` database in local Postgres, or update `DATABASE_URL` (issue 4)
7. [ ] Make the root `.env` visible to Prisma, then run `npm run db:migrate`
8. [ ] Install `yt-dlp` and `ffmpeg` (issue 7)
9. [ ] Fix the 2 TypeScript errors (issue 6), then confirm with `npm run typecheck`
10. [ ] `npm run dev`
