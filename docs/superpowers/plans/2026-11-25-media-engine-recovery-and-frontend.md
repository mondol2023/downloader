# Media Engine — Recovery, Eligibility & Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get `npm run dev` working on this Windows machine. Make the data layer survive a Postgres outage. Enforce a clear policy on which content can be downloaded. Put every site/download restriction in one policy file that an admin can tune at runtime. Then build the missing `apps/web` frontend with a deliberate motion system, an admin console and a CMS with a full rich-text editor.

**Architecture:** The repo stays an npm-workspaces monorepo (`@media/shared`, `@media/api`, new `@media/web`).
- New backend code goes in feature modules under `apps/api/src/features/<feature>/`, each with its own tests. Existing `routes/ services/ lib/` code is left where it is; don't do a big-bang refactor.
- The frontend is a Next.js App Router app with feature-sliced folders: `apps/web/src/features/<feature>/{components,hooks,api}`.
- The frontend proxies `/api/v1/*` to the API, so auth cookies stay same-origin.

**Tech Stack:** Node 24, TypeScript 5.7, Express 4, BullMQ 5, Prisma 6, PostgreSQL 18 (native Windows service), Memurai (Redis), yt-dlp + ffmpeg, Vitest, Next.js 15 + React 19, Tailwind CSS v4, `motion` (`motion/react`), Radix primitives, TanStack Query, Playwright, `googleapis` (Sheets mirror, optional), `zod` (policy schema), Tiptap 2 (rich-text editor), `sanitize-html`, `sharp` (CMS image uploads).

**Spec:** [DEV_ISSUES_REPORT.md](../../../DEV_ISSUES_REPORT.md) (diagnosis), plus the user's requests in this plan's "Requirements" section.

---

## ▶ Resume here (read this first when you come back)

You don't need any memory of earlier sessions. Do this:

1. Find the **first phase in the table below whose status isn't ✅**.
2. Run its **Entry check** command. If that passes, start at that phase's first unchecked `- [ ]` box.
3. When a phase's **Exit check** passes, change its row to ✅ and commit this file.

| Phase | Name | Status | Entry check | Exit check |
|---|---|---|---|---|
| 0 | Unblock local dev | ✅ | `npm run dev` fails | `npm run dev` → api "listening 4000" + worker "ready", no errors |
| 1 | Database + resilient persistence | ⬜ | Phase 0 ✅ | `npm test -w @media/api` green; `npm run db:migrate` applied; kill Postgres → `/healthz` reports `degraded`, extraction still works |
| 2 | Restriction policy + content eligibility | 🟨 | Phase 1 ✅ | policy + eligibility tests green; private/members/DRM URLs refused with typed codes; `GET /api/v1/policy/public` returns the effective limits |
| 3 | Region-aware extraction | ⬜ | Phase 2 ✅ | region router tests green; geo-blocked result returns 451 + explanation |
| 4 | Backend hardening | ⬜ | Phase 3 ✅ | `npm run typecheck && npm test` green; `/healthz` lists tool versions |
| 5 | Frontend foundation + design system | ✅ | Phase 0 ✅ (can run parallel to 1-4) | `npm run dev` starts `web` on :3000; tokens page renders |
| 6 | Frontend features | 🟨 | Phase 5 ✅, Phase 2 ✅ | Playwright happy-path passes — **mocked E2E green (39 pass); live `E2E_LIVE=1` happy path not run; uncommitted** |
| 7 | Motion system | ⬜ | Phase 6 ✅ | motion checklist all ✓; reduced-motion E2E passes |
| 8 | Admin console | ⬜ | Phase 6 ✅ | admin E2E passes: disable a platform → a normal user's extract is refused within 5 s; non-admin gets 403 everywhere under `/admin` |
| 9 | CMS + rich-text editor | ⬜ | Phase 8 ✅ | CMS E2E passes: write a styled page → publish → `/p/<slug>` renders it; XSS fixture is stripped |
| 10 | Quality, security, deploy | ⬜ | Phase 9 ✅ | CI green; `docker compose up` boots all services |

**Already done before this plan** (no need to redo; it's all gitignored):
- `packages/shared/dist` was built.
- The Prisma client was generated.
- `DEV_ISSUES_REPORT.md` was written.

**How to run each task cheaply:** see [Execution strategy (cost-first)](#execution-strategy-cost-first). Each task is tagged `[native|agent · model · effort]`.

**Status legend:** ⬜ not started · 🟨 in progress · ✅ done · ⛔ blocked (write the reason in the row)

---

## Execution strategy (cost-first)

The user wants the **cheapest** way to build this. The rules:

1. **Default is native.** You (the session) implement the task yourself. No subagent, no per-task reviewer. Run the session on **Sonnet** (`/model sonnet`) for every phase; it's enough because this plan carries the design decisions.
2. **Delegate only when a task is too big for the session to do cheaply**: it touches more than ~10 files, or it needs a design skill (impeccable, frontend-design, ui-ux-pro-max, motion) whose instructions would fill the session's context. Hand it to **one** subagent with the smallest model that can do it:
   - `haiku` for repetitive CRUD screens and config on patterns that already exist.
   - `sonnet` for normal feature work and UI with real decisions.
   - `opus` **only** for the two review gates (Task 4.4 and Task 10.3). Nothing else uses Opus.
3. **Effort** in the tag maps to the agent's `effort` setting: `low` for mechanical edits, `medium` by default, `high` only where a mistake is a security or data bug (policy store, CMS sanitiser, editor).
4. **Start a fresh session per phase** (`/clear`, then "continue the plan"). The Resume table makes this free, and a short context is the biggest cost saving.
5. **No parallel agents by default.** Phase 5 *can* run alongside Phases 1–4, but only do that if speed matters more than cost.

| Phase | Session model | Native tasks | Delegated tasks (model · effort) |
|---|---|---|---|
| 0 | sonnet | 0.1–0.4 (low) | — |
| 1 | sonnet | 1.1–1.4 (medium) | 1.5 Sheets mirror, optional (haiku · medium) |
| 2 | sonnet | 2.0–2.4 (medium; 2.1 low) | — |
| 3 | sonnet | 3.1–3.2 (medium) | — |
| 4 | sonnet | 4.1–4.3 (low) | 4.4 review gate (opus · high) |
| 5 | sonnet | 5.1, 5.3 (low) | 5.2 tokens + primitives, loads design skills (sonnet · medium) |
| 6 | sonnet | — | one agent per feature: extract, formats, player, jobs (sonnet · medium); auth, billing, history (haiku · medium) |
| 7 | sonnet | 7.1, 7.3, 7.4 (medium) | 7.2 choreography, loads motion skills (sonnet · medium); 7.5 review-animations (sonnet · medium) |
| 8 | sonnet | 8.1, 8.2 (medium) | 8.3 shell + dashboard (sonnet · medium); 8.4 restrictions editor (sonnet · high); 8.5 CRUD screens (haiku · medium) |
| 9 | sonnet | 9.1 (high), 9.4 (low) | 9.2 rich-text editor (sonnet · high); 9.3 CMS screens (haiku · medium) |
| 10 | sonnet | 10.1, 10.2, 10.4–10.6 (medium) | 10.3 security review gate (opus · high) |

When you delegate, give the agent: this plan's path, the task number, the Interfaces of the tasks it consumes, and "commit when the task's tests pass". Check its result with the task's own test command; don't spawn a reviewer.

## Requirements (from the user, verbatim intent)

1. Fix every problem in `DEV_ISSUES_REPORT.md`.
2. If the DB isn't working, still store data somewhere, with Google Sheets/Docs as an option.
3. Build the frontend with suitable motion (spring, fade in/out, stagger, …) using the impeccable / frontend-design / ui-ux-pro-max / motion skills.
4. Split the work into phases that can be resumed cold.
5. Decide which content is eligible: skip private YouTube videos and anything else that isn't public.
6. For region-locked content, use only *safe* technical means.
7. Organise the work by feature (feature-based architecture).
8. One restriction file in the project controls all site and download restriction logic.
9. An admin console controls everything (restrictions, sites, tiers, takedowns, users, jobs, content).
10. A CMS in the admin with a rich-text editor offering all styling options.
11. Cheapest execution: native by default; a task too big for the session goes to a subagent with a suitable model and effort.

## Global Constraints

- Node `>=20.11.0` (the machine has v24.22.1). All commands must work in **PowerShell on Windows**. Never rely on `&&` inside npm scripts that must run in PS 5.1; npm runs scripts through `cmd`, where `&&` is fine.
- The root `.env` is the single source of truth. Never commit it, and never print its secret values in logs, docs or the UI.
- **No content-protection circumvention.** That means no DRM decryption, no login cookies used on users' behalf, no spoofed geo headers, and no rotating proxy/VPN pools. (See Phase 2/3 for the reasoning.)
- **Restriction hard floor.** Refusing private, members-only, login-required and DRM content, plus the DRM-platform host blocklist, lives in code in `restrictions.config.ts` and **can't be relaxed from the admin**. Admin overrides can tune the soft rules and add restrictions. The override schema has no field for the hard floor, so this isn't a UI choice a forged request can bypass.
- Restrictions **fail closed**: if overrides can't be loaded, use the last-known-good snapshot, then the code defaults. An empty or unparsable policy is never used.
- The API error contract stays `AppError(status, code, message)`. New refusal codes are `SOURCE_*` strings, added to `@media/shared`.
- Feature modules: `apps/api/src/features/<name>/index.ts` is the only import surface. Tests live in `apps/api/test/features/<name>/*.test.ts`.
- Frontend motion may animate **transform and opacity only** (plus `clip-path` for reveals). Durations are ≤ 320 ms for UI, and exits run at about 70 % of enter time. Every animation has a `prefers-reduced-motion` path.
- Commit after every task. Use Conventional Commit messages (`feat:`, `fix:`, `chore:`, `test:`).

## Review Focus

These are the failure modes most likely to hurt a real user that no single task naturally tests. Each one is pinned by a test in the task named.

1. **A video turns private between extraction and download.** The worker must fail the job with `SOURCE_PRIVATE` (not a generic 502), and the quota must not be charged. → Task 2.3
2. **Unlisted YouTube link.** It's reachable by anyone holding the link, so it's allowed. It must not be misclassified as private. → Task 2.1
3. **Postgres goes down mid-session.** Guest extraction and playback keep working. Login, billing and new download jobs return `503 DEGRADED` with a human message. Nothing hangs for 30 s on a Prisma timeout. → Task 1.3
4. **Spoofed country header from a client not behind the trusted proxy.** It must be ignored, so a user can't choose another region by forging `CF-IPCountry`. → Task 3.1
5. **A user with reduced motion enabled pastes a URL.** No transform animation runs, and opacity fades are ≤ 150 ms. → Task 7.4
6. **An admin, or a forged request, tries to un-block Netflix or allow private videos through the overrides API.** It's rejected with 422 `POLICY_INVALID` and the active policy is unchanged. → Task 2.0
7. **Postgres is down when the API boots.** The policy loads from the snapshot file or the code defaults, never from an empty object, so nothing becomes *more* permissive. → Task 2.4
8. **Stored XSS through the CMS** (`<img onerror>`, `javascript:` links, `style="position:fixed"`, pasted Word HTML). It's stripped on save, and the public page renders only allow-listed tags and styles. → Task 9.1

---

## Target file structure

```
apps/api/
  prisma.config.ts                  # NEW  loads ../../.env for the Prisma CLI, seed config
  prisma/seed.ts                    # NEW  demo FREE + PRO users
  prisma/migrations/                # NEW  generated by `prisma migrate dev`
  vitest.config.ts                  # NEW
  src/features/
    persistence/                    # NEW  db health probe, degraded mode, outbox, sheets mirror
      db-health.ts  degraded.ts  outbox.ts  sheets-sink.ts  index.ts
    eligibility/                    # NEW  content policy (private/members/DRM/age/live/blocked hosts)
      blocked-hosts.ts  eligibility.ts  index.ts
    regions/                        # NEW  user-region resolution + regional extraction queues
      region.ts  regional-extract.ts  index.ts
    health/                         # NEW  /healthz with db/redis/tools status
      health.routes.ts  tool-versions.ts  index.ts
    restrictions/                   # NEW  ★ THE restriction file + policy engine
      restrictions.config.ts        #      ← edit site/download rules here (code defaults + hard floor)
      policy.schema.ts  merge.ts  policy.store.ts  enforce.ts  policy.routes.ts  index.ts
    admin/                          # NEW  /api/v1/admin/* (role-guarded)
      require-role.ts  policy.admin.ts  takedowns.admin.ts  users.admin.ts  jobs.admin.ts  audit.admin.ts  index.ts
    cms/                            # NEW  pages, blocks, revisions, assets
      cms.routes.ts  cms.service.ts  assets.ts  index.ts
  src/lib/exec.ts                   # MODIFY  type fix (6a)
  src/lib/stripe.ts                 # MODIFY  apiVersion fix (6b)
  src/services/extraction.service.ts# MODIFY  read availability/DRM fields, call eligibility, --xff never
  src/queue/worker.ts               # MODIFY  re-check eligibility, outbox on DB failure
  test/features/**                  # NEW
apps/web/                           # NEW  Next.js app (@media/web)
  src/app/                          # routes only — thin
  src/features/{extract,formats,jobs,player,auth,billing,history}/
  src/features/admin/{shell,dashboard,policy,sites,tiers,takedowns,users,jobs,audit}/
  src/features/cms/{editor,pages,blocks,media-library,render}/
  src/app/(admin)/admin/**          # admin routes (thin)
  src/app/(site)/p/[slug]/          # public CMS pages
  src/design/{tokens.css,motion.ts,typography.ts}
  src/components/ui/                # primitives (Button, Card, Sheet, Toast, Progress)
  e2e/                              # Playwright
packages/shared/src/eligibility.ts  # NEW  SOURCE_* codes + user-facing copy
packages/shared/src/policy.ts       # NEW  PublicPolicy type (what the web app may read)
packages/rich-text/                 # NEW  @media/rich-text: one Tiptap extension list + renderHtml + sanitize, used by api AND web
apps/api/Dockerfile, apps/web/Dockerfile   # NEW (Phase 10)
```

---

# Phase 0 — Unblock local dev

**Entry:** `npm run dev` fails. **Exit:** api logs `listening, port 4000`, and the worker logs `ready` and stays up (it will only log the DB auth error if Phase 1 Task 1.1 hasn't been done yet).

### Task 0.1: Load the root `.env` everywhere

**Files:**
- Modify: `apps/api/package.json` (scripts)
- Create: `apps/api/prisma.config.ts`
- Modify: `apps/api/package.json` (remove the deprecated `"prisma"` key, add a `dotenv` devDependency)

- [ ] **Step 1:** Change the scripts to the following (all paths are relative to `apps/api`):
  ```json
  "dev": "tsx watch --env-file=../../.env src/index.ts",
  "dev:worker": "tsx watch --env-file=../../.env src/queue/worker.ts",
  "start": "node --env-file=../../.env dist/index.js",
  "start:worker": "node --env-file=../../.env dist/queue/worker.js",
  "db:seed": "tsx --env-file=../../.env prisma/seed.ts",
  "postinstall": "prisma generate"
  ```
- [ ] **Step 2:** `npm i -D dotenv -w @media/api`. Create `prisma.config.ts` with `defineConfig({ schema: 'prisma/schema.prisma' })`. Before it, call `config({ path: resolve(<this file's dir>, '../../.env') })`. When `prisma.config.ts` exists, Prisma stops auto-loading `.env`, which is why this call is needed. Move the seed command into the config (`migrations.seed`) **only if** the installed Prisma version supports it (check with `npx prisma --version` and the Prisma docs). Otherwise keep `package.json#prisma.seed`.
- [ ] **Step 3: Verify.** `npx prisma validate` (run in `apps/api`) should print "The schema … is valid" and no "Environment variable not found" error.
- [ ] **Step 4:** Commit `chore(api): load root .env for tsx, node and prisma`.

### Task 0.2: Root scripts — drop missing web, watch shared

**Files:** Modify: root `package.json`

- [ ] **Step 1:** Set `"predev": "npm run build -w @media/shared"`.
- [ ] **Step 2:** Set `"dev": "concurrently -n shared,api,worker -c gray,blue,magenta \"npm run dev -w @media/shared\" \"npm run dev -w @media/api\" \"npm run dev:worker -w @media/api\""`. Phase 5 adds `web` back.
- [ ] **Step 3:** Make `build` skip web until it exists: replace `npm run build -w @media/web` with `npm run build -w @media/web --if-present`.
- [ ] **Step 4: Verify.** Run `npm run dev`. There should be no "No workspaces found", "Required" or "Cannot find module" errors.
- [ ] **Step 5:** Commit `chore: fix dev/build scripts for current workspaces`.

### Task 0.3: Fix the two TypeScript errors

**Files:** Modify `apps/api/src/lib/exec.ts:64-66` and `apps/api/src/lib/stripe.ts:21`

- [ ] **Step 1:** In `exec.ts`, type the child as `ChildProcessByStdio<null, Readable, Readable>` (`import type` from `node:child_process` and `node:stream`).
- [ ] **Step 2:** In `stripe.ts`, pin `"stripe": "17.5.0"` exactly in `apps/api/package.json` and run `npm install`. Pinning is the recommended fix because it keeps the webhook payload shapes the code was written against. Only bump to `'2025-02-24.acacia'` later, as a separate reviewed change.
- [ ] **Step 3: Verify.** `npm run typecheck` should exit 0.
- [ ] **Step 4:** Commit `fix(api): correct spawn stdio typing and pin stripe SDK`.

### Task 0.4: Install system tools

- [ ] **Step 1:** `winget install yt-dlp.yt-dlp Gyan.FFmpeg`, then open a new terminal.
- [ ] **Step 2: Verify.** `yt-dlp --version; ffmpeg -version; ffprobe -version` should all print versions. If they aren't on PATH, set `YTDLP_PATH`, `FFMPEG_PATH` and `FFPROBE_PATH` in `.env` to absolute paths.
- [ ] **Step 3:** Generate real dev secrets for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `STREAM_SIGNING_SECRET` with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Put them in `.env`. Never paste them anywhere else.

---

# Phase 1 — Database + resilient persistence

**Design decision (senior-architect note on Google Sheets):** Google Sheets is **not** a database. Its API is rate-limited (roughly 60 requests/minute per user and 300/minute per project at the time of writing; check the current quotas). It has no transactions, no unique constraints and no row locking. The auth tables (refresh-token rotation) and Stripe webhook idempotency depend on exactly those guarantees, so putting them in Sheets would create security bugs.

The resilient design is:

| Layer | Role | When |
|---|---|---|
| **PostgreSQL** | System of record | Always, when up |
| **Redis (Memurai)** | Quota counters, rate limits, extraction cache | Already true. It keeps guest flows alive when Postgres is down. |
| **JSONL outbox** (`STORAGE_DIR/outbox/*.jsonl`) | Durable local buffer for ledger and audit rows written while Postgres is down | Degraded mode. Drained into Postgres on recovery. |
| **Google Sheets mirror** (optional) | Append-only, human-readable copy of `DownloadLog` and `AuditEvent` rows for ops/reporting, plus an off-box backup of the ledger | Always-on if configured. Never read back by the app. |

In **degraded mode** these keep working: guest/anonymous extraction, metadata pages from the Redis cache, and playback of already-signed streams. These return `503 DEGRADED`: login, register, refresh, billing and **new download jobs** (jobs live in Postgres). The UI shows a calm banner (Phase 6).

### Task 1.1: Local Postgres role, DB, migrations, seed

**Files:** Create `apps/api/prisma/seed.ts` and `scripts/setup-local-db.sql`

- [ ] **Step 1:** Write `scripts/setup-local-db.sql`:
  ```sql
  CREATE ROLE media WITH LOGIN PASSWORD 'media';
  CREATE DATABASE media_engine OWNER media;
  ```
  Run it once as superuser: `psql -U postgres -h localhost -f scripts/setup-local-db.sql`. (`psql` lives in `C:\Program Files\PostgreSQL\18\bin`.) The password must match `DATABASE_URL` in `.env`.
- [ ] **Step 2:** `npm run db:migrate -- --name init`. This creates `apps/api/prisma/migrations/<ts>_init/`.
- [ ] **Step 3:** Write `seed.ts`. It upserts `free@example.test` (tier FREE) and `pro@example.test` (tier PRO). Both use the password `Password123!` hashed with argon2id, through the same helper as `user.service.ts`. The seed must be idempotent (`upsert` on email).
- [ ] **Step 4: Verify.** Running `npm run db:seed` twice should succeed both times. In `npm run dev` the worker should log `ready` with no P1000 error.
- [ ] **Step 5:** Commit `feat(db): initial migration, seed and local setup script`, including the migrations folder.

### Task 1.2: Test harness

**Files:** Create `apps/api/vitest.config.ts`. Modify `apps/api/package.json`, adding `"test": "vitest run"` and `"test:watch": "vitest"` plus the devDependency `vitest`.

- [ ] **Step 1:** Write `test/smoke.test.ts` with `expect(1).toBe(1)`. `npm test -w @media/api` should pass.
- [ ] **Step 2:** Commit `test(api): add vitest`.

### Task 1.3: DB health probe + degraded mode

**Files:** Create `src/features/persistence/{db-health.ts,degraded.ts,index.ts}`. Modify `src/index.ts` (mount the middleware) and `src/lib/prisma.ts` (connection timeout). Test: `test/features/persistence/degraded.test.ts`.

**Interfaces (Produces):**
```ts
export interface DbHealth { up: boolean; since: Date; lastError: string | null }
export function startDbHealthProbe(opts?: { intervalMs?: number; probe?: () => Promise<void> }): () => void // returns stop()
export function getDbHealth(): DbHealth
export const requireDatabase: express.RequestHandler   // 503 DEGRADED when !up
```

- [x] **Step 1: Write failing tests.**
  - `requireDatabase returns 503 DEGRADED when probe fails`: inject a `probe` that rejects, then assert `res.status === 503` and body `code === 'DEGRADED'`.
  - `requireDatabase passes through when probe succeeds`.
  - `health flips back to up after a successful probe` (use fake timers).
  - `probe failure is detected within 2 intervals` (interval 5000 ms → down by 10 s).
- [x] **Step 2:** Run them and confirm they fail.
- [x] **Step 3:** Implement it. The default probe is `prisma.$queryRaw\`SELECT 1\`` with a 2000 ms race timeout, run every 5000 ms. Add `connect_timeout=5` to the Prisma URL query string if it's missing, so requests fail fast instead of hanging.
- [x] **Step 4:** Mount `requireDatabase` on `/auth`, `/billing` and `POST /jobs`, but not on `/media/*` or `GET /jobs/:id/artifact`.
- [x] **Step 5:** Run the tests and confirm they pass. Manual check: stop the `postgresql-x64-18` service. `POST /api/v1/media/extract` should still return 200, and `POST /api/v1/auth/login` should return 503 within 100 ms.
- [x] **Step 6:** Commit `feat(api): db health probe and degraded mode`.

### Task 1.4: JSONL outbox for ledger/audit writes

**Files:** Create `src/features/persistence/outbox.ts`. Modify the call sites that write `DownloadLog` / `AuditEvent` (`quota.service.ts` and the worker) so they go through `recordLedger()`. Test: `test/features/persistence/outbox.test.ts`.

**Interfaces (Produces):**
```ts
export type OutboxKind = 'download_log' | 'audit_event';
export interface OutboxRecord { kind: OutboxKind; id: string; at: string; data: Record<string, unknown> }
export async function recordLedger(rec: OutboxRecord): Promise<'db' | 'outbox'>   // try DB, fall back
export async function drainOutbox(write?: (r: OutboxRecord) => Promise<void>): Promise<{ drained: number; failed: number }>
```

- [x] **Step 1: Failing tests** (use a temp `STORAGE_DIR`):
  - `recordLedger writes to outbox when db is down` → the file `outbox/2026-11-25.jsonl` contains 1 line whose `id` matches.
  - `drainOutbox is idempotent`: draining twice must not create duplicates. Use the record `id` as the primary key with `createMany({ skipDuplicates: true })`.
  - `drainOutbox keeps lines that failed`: if the writer rejects for 1 of 3 records, the file keeps exactly that 1 line.
  - `BigInt fields survive the round trip` (`bytes` serialized as a string, then parsed back).
- [x] **Step 2:** Implement it. Use append-only `fs.appendFile` with one JSON object per line. Drain via a rename to `*.draining` before reading, so it's crash-safe. Trigger the drain when `getDbHealth()` goes from down to up.
- [x] **Step 3:** Tests should pass. Commit `feat(api): outbox for ledger writes during db outage`.

### Task 1.5 (optional): Google Sheets mirror

**Files:** Create `src/features/persistence/sheets-sink.ts`. Add env keys `SHEETS_SPREADSHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_FILE` (both optional; the feature is off when either is unset). Test: `test/features/persistence/sheets-sink.test.ts`.

**Interfaces:**
```ts
export interface LedgerSink { write(batch: OutboxRecord[]): Promise<void> }
export function createSheetsSink(cfg: { spreadsheetId: string; keyFile: string; client?: SheetsClientLike }): LedgerSink
export function startSheetsMirror(sink: LedgerSink, opts?: { flushMs?: number; maxBatch?: number }): () => void
```

- [x] **Step 1: Tests** (with a fake `SheetsClientLike`):
  - `batches up to 500 rows per append call`.
  - `flushes every 30_000 ms`.
  - `drops PII columns`: the row has `ip` and `userAgent` removed, and `guestKey` replaced by its sha256 prefix.
  - `a 429 response backs off and retries` (exponential, max 5 tries, then the rows go back into the queue).
- [x] **Step 2:** Implement it with `googleapis` → `sheets.spreadsheets.values.append` (`valueInputOption: 'RAW'`). Use one tab per kind (`download_log`, `audit_event`). The header row is written once.
- [x] **Step 3: Setup docs** (add to the README):
  1. Create a GCP service account and enable the Sheets API.
  2. Share the sheet with the service-account email as Editor.
  3. Store the key JSON **outside the repo** and point `GOOGLE_SERVICE_ACCOUNT_FILE` at it.
- [x] **Step 4:** Commit `feat(api): optional google sheets ledger mirror`.

> Google Docs is the wrong tool for data. Use Sheets for tabular rows. Docs is fine for a human-written ops runbook, and nothing else.

---

# Phase 2 — Restriction policy + content eligibility

### Policy (decided — the code enforces exactly this)

yt-dlp exposes `availability` (`public` | `unlisted` | `private` | `premium_only` | `subscriber_only` | `needs_auth` | null), `live_status`, `age_limit`, and per-format `has_drm`. We decide using those fields **before** caching or showing formats.

| Condition | Verdict | Code | Why |
|---|---|---|---|
| `availability = public` | ✅ allow | — | Publicly viewable |
| `availability = unlisted` | ✅ allow | — | Anyone with the link can watch it; the user has the link |
| `availability = null` (many non-YT sites) | ✅ allow, provided extraction succeeded *without cookies* | — | Anonymous fetch succeeded, so it's public |
| `private` | ❌ refuse | `SOURCE_PRIVATE` | The owner restricted it |
| `premium_only`, `subscriber_only` (members, Premium, paid) | ❌ refuse | `SOURCE_MEMBERS_ONLY` | Paid/members content |
| `needs_auth` / "login required" | ❌ refuse | `SOURCE_NEEDS_LOGIN` | We never sign in on a user's behalf |
| any format `has_drm` / all formats DRM | ❌ drop those formats; refuse if none remain | `SOURCE_DRM` | Circumventing DRM is illegal in most jurisdictions (DMCA §1201, EU InfoSoc Art. 6) |
| `age_limit >= 18` | ❌ refuse | `SOURCE_AGE_RESTRICTED` | Needs a signed-in, age-verified account on the source |
| `live_status = is_live / is_upcoming` | ❌ refuse download (playback allowed if a stream URL exists) | `SOURCE_LIVE` | Unbounded size; retry once it becomes `was_live` |
| Host on the DRM-platform blocklist | ❌ refuse before yt-dlp runs | `SOURCE_BLOCKED_DOMAIN` | Saves a pointless extraction |

**Also change:** in production, disable `YTDLP_COOKIES_FILE` (log a warning and ignore it when `NODE_ENV=production`). A shared cookie jar fetches members/age-gated content *as our account*, which violates every platform's ToS and gets the account banned.

### Site eligibility matrix (public content only, no login)

| Platform | Eligible content | Typically ineligible | Notes |
|---|---|---|---|
| YouTube | Public + unlisted videos, Shorts, ended live VODs | Private, members-only, Premium, age-gated, upcoming/live | Most reliable extractor; keep yt-dlp updated (Phase 4) |
| Vimeo | Public videos | Password-protected, private, Vimeo OTT paid | — |
| Dailymotion | Public videos | Private, geo-limited partner content | — |
| SoundCloud | Tracks with free streaming | "Go+" snippets (30 s previews only), private links | Previews must be labelled "preview" in the UI |
| TikTok | Public videos | Private accounts, friends-only | Watermark-free only when the platform serves it |
| Instagram | Public reels/posts *when served without login* | Most stories, private accounts, anything behind the login wall | Expect frequent `SOURCE_NEEDS_LOGIN`; that's correct behaviour |
| Facebook | Public page/profile videos | Group, friends-only, login-walled | Same as Instagram |
| X (Twitter) | Public posts with video | Protected accounts, sensitive-media-gated | — |
| Reddit | Public posts (v.redd.it) | Private/quarantined subs, NSFW-gated | Needs ffmpeg mux (separate audio) |
| Twitch | VODs, clips, highlights | Sub-only VODs, live streams (download) | — |
| Bilibili | Public videos | Premium/"大会员" renditions | Higher resolutions are often premium → drop those formats |
| Pinterest, Tumblr, LinkedIn | Public video pins/posts | Login-walled posts | Best-effort |
| **Netflix, Disney+, Prime Video, Hulu, Max, Apple TV+, Spotify, Apple Music, Crunchyroll, Tidal, Deezer** | ❌ none | everything | DRM-only. Hard blocklist. |

Product/legal note: several platforms' Terms of Service forbid downloading even public content. Before launch, ship these (takedown blocklist in Phase 8, pages through the CMS in Phase 9, wiring in Phase 10):
- a Terms page saying users may only download content they own or have rights to,
- a rights confirmation on first download,
- a DMCA/takedown contact with a per-`mediaId` takedown blocklist.

### Task 2.0: The restriction file + policy engine (pure)  `[native · sonnet · medium]`

This is **the one place** that decides site and download restrictions. Everything else reads the *effective policy* from here instead of hard-coding limits: URL normalisation, eligibility, format filtering, job admission, the worker and the pricing page.

**Files:**
- Create `apps/api/src/features/restrictions/restrictions.config.ts`: the code defaults and the hard floor. Header comment: "Edit this file to change defaults. Runtime changes go through Admin → Restrictions."
- Create `policy.schema.ts` (zod), `merge.ts`, `index.ts` in the same folder.
- Test: `test/features/restrictions/merge.test.ts`.

**Interfaces (Produces):**
```ts
// restrictions.config.ts
export const HARD_FLOOR: Readonly<{
  refuse: readonly IneligibleCode[];   // SOURCE_PRIVATE, SOURCE_MEMBERS_ONLY, SOURCE_NEEDS_LOGIN, SOURCE_DRM
  blockedHosts: readonly string[];     // the DRM-only platforms from the site matrix
  maxAgeLimit: 17;                     // age_limit >= 18 is always refused
}>;
export const DEFAULT_POLICY: SoftPolicy;   // tiers default to TIER_POLICIES from @media/shared

// policy.schema.ts — soft, admin-tunable
export type PlatformId = 'youtube'|'facebook'|'instagram'|'x'|'tiktok'|'reddit'|'vimeo'|'twitch'
  |'dailymotion'|'soundcloud'|'bilibili'|'pinterest'|'linkedin'|'tumblr';   // = PLATFORM_BY_SUFFIX values
export interface SoftPolicy {
  global: { maintenanceMode: boolean; maintenanceMessage: string; extractionEnabled: boolean;
            downloadsEnabled: boolean; maxDurationSec: number; allowLiveVod: boolean;
            ageLimitMax: number /* ≤ 17 */; extraBlockedHosts: string[] };
  tiers: Record<Tier, Pick<TierPolicy, 'maxHeight'|'maxFps'|'maxFileSizeBytes'|'dailyDownloads'
            |'maxConcurrentJobs'|'audioFormats'|'allowTranscode'|'allowStreaming'
            |'maxPlaylistItems'|'hourlyExtractions'>>;
  platforms: Record<PlatformId, { enabled: boolean; download: boolean; playback: boolean;
            maxHeight: number | null; note: string }>;
}
export const PolicyOverridesSchema: z.ZodType<DeepPartial<SoftPolicy>>;   // .strict() at every level
export interface EffectivePolicy extends SoftPolicy { hardFloor: typeof HARD_FLOOR; version: number }

// merge.ts
export function mergePolicy(defaults: SoftPolicy, overrides: unknown, version: number): EffectivePolicy
//   throws AppError(422, 'POLICY_INVALID', <zod issue paths>) when overrides fail the schema
export function toPublicPolicy(p: EffectivePolicy): PublicPolicy   // tiers + per-platform enabled/download only
```

- [x] **Step 1: Failing tests:**
  - `empty overrides → defaults`
  - `override tiers.FREE.maxHeight 720 → effective 720`
  - `override containing key hardFloor → POLICY_INVALID`
  - `ageLimitMax 18 → POLICY_INVALID`
  - `unknown platform key 'netflix' → POLICY_INVALID`
  - `extraBlockedHosts adds to, never replaces, HARD_FLOOR.blockedHosts`
  - `negative or NaN limits → POLICY_INVALID`
- [x] **Step 2:** Implement. Deep-merge plain objects; arrays replace.
- [x] **Step 3:** Tests pass. Commit `feat(api): restriction policy file and merge engine`.

### Task 2.1: Eligibility evaluator (pure function)  `[native · sonnet · low]`

**Files:** Create `packages/shared/src/eligibility.ts` (codes and copy), `apps/api/src/features/eligibility/{eligibility.ts,blocked-hosts.ts,index.ts}`. Test: `test/features/eligibility/eligibility.test.ts`.

**Interfaces (Produces):**
```ts
// shared
export const INELIGIBLE_CODES = ['SOURCE_PRIVATE','SOURCE_MEMBERS_ONLY','SOURCE_NEEDS_LOGIN','SOURCE_DRM',
  'SOURCE_AGE_RESTRICTED','SOURCE_LIVE','SOURCE_BLOCKED_DOMAIN','SOURCE_GEOBLOCKED'] as const;
export type IneligibleCode = typeof INELIGIBLE_CODES[number];
export const INELIGIBLE_COPY: Record<IneligibleCode, { title: string; body: string }>;
// api
export interface EligibilityInput { availability: string | null; liveStatus: string | null; ageLimit: number;
  formatDrm: boolean[]; host: string }
export type EligibilityVerdict = { eligible: true; dropFormatIndexes: number[] }
                               | { eligible: false; code: IneligibleCode };
export function evaluateEligibility(input: EligibilityInput): EligibilityVerdict
export function isBlockedHost(host: string, policy: EffectivePolicy): boolean   // suffix match on hardFloor.blockedHosts ∪ global.extraBlockedHosts
```

- [x] **Step 1: Failing table test.** Use one `it.each` row per line of the policy table above, plus these:
  - `unlisted → eligible`
  - `null availability → eligible`
  - `formatDrm [true,false,true] → eligible, dropFormatIndexes [0,2]`
  - `formatDrm [true,true] → SOURCE_DRM`
  - `age_limit 17 → eligible; 18 → SOURCE_AGE_RESTRICTED`
  - `live_status was_live → eligible`
  - `isBlockedHost('www.netflix.com') → true`, `isBlockedHost('notnetflix.com') → false`
- [x] **Step 2:** Implement it. Check order: blocked host → private → members → needs_auth → age → live → DRM.
- [x] **Step 3:** Tests should pass. Commit `feat: content eligibility policy`.

### Task 2.2: Wire eligibility into extraction  `[native · sonnet · medium]`

**Files:** Modify `src/services/extraction.service.ts`: the `YtDlpPayload` type (add `availability?`, `live_status?`, `formats[].has_drm?`), the arg list (~line 240), `buildRecord`, and `translateExtractionError` (~line 286). Modify `src/lib/source-url.ts` to call `isBlockedHost` after `isPrivateHostname`. Modify `packages/shared/src/media.ts` to add `availability: string | null` to `MediaMetadata`.

- [x] **Step 1: Failing tests** for `buildRecord` with fixture JSON in `test/fixtures/ytdlp/`:
  - `private.json` → throws `AppError` with code `SOURCE_PRIVATE`, status 403
  - `members.json` → `SOURCE_MEMBERS_ONLY`
  - `drm-mixed.json` → returns a record with DRM formats removed
  - `normaliseSourceUrl('https://www.netflix.com/watch/1')` → `SOURCE_BLOCKED_DOMAIN`, status 403
- [x] **Step 2:** Implement it.
  - Add `'--xff', 'never'` to the args so yt-dlp never fakes `X-Forwarded-For`. On an old build use `--no-geo-bypass`, and check with `yt-dlp --help`.
  - Map the stderr phrases `members-only`, `join this channel` and `premium` to `SOURCE_MEMBERS_ONLY`.
  - Cache refusals in Redis for 600 s under `elig:{mediaId}` so repeat pastes don't re-run yt-dlp.
- [x] **Step 3:** Tests should pass, and `npm run typecheck` should be green. Commit `feat(api): enforce eligibility at extraction`.

### Task 2.3: Re-check in the worker (the media changed after extraction)  `[native · sonnet · medium]`

**Files:** Modify `src/queue/worker.ts` (error path). Test: `test/features/eligibility/worker-recheck.test.ts`.

- [x] **Step 1: Failing test** `job fails with SOURCE_PRIVATE and no quota charge when download stderr says private`. Fake `runCommand` to reject with a `CommandError` whose stderr is `"Private video"`. Assert that `job.state === 'FAILED'`, `job.error` starts with `SOURCE_PRIVATE`, and the `DownloadLog` count is unchanged.
- [x] **Step 2:** Reuse `translateExtractionError` (export it from the extraction service). Write the code into `job.error` as `"<CODE>: <message>"`.
- [x] **Step 3:** Tests should pass. Commit `fix(worker): typed refusal when source turns private`.

### Task 2.4: Policy store + enforcement points  `[native · sonnet · high]`

**Files:** Create `features/restrictions/{policy.store.ts,enforce.ts,policy.routes.ts}`. A Prisma migration adds:
```prisma
model PolicyVersion {
  id          String   @id @default(cuid())
  version     Int      @unique
  overrides   Json
  note        String
  active      Boolean  @default(false)
  createdById String?
  createdAt   DateTime @default(now())
  @@index([active])
}
```
Modify:
- `src/lib/source-url.ts`: the platform must be `enabled`.
- `extraction.service.ts`: per-platform `maxHeight` ∩ tier `maxHeight`, and `maxDurationSec`.
- `routes/jobs.routes.ts`: `downloadsEnabled`, `maintenanceMode`, and tier quotas from the policy instead of `TIER_POLICIES`.
- `queue/worker.ts`: re-read the policy before downloading.

Tests: `test/features/restrictions/{store,enforce}.test.ts`.

**Interfaces (Produces):**
```ts
export function getPolicy(): EffectivePolicy        // sync, in-memory, always defined
export async function startPolicyStore(deps: { prisma: PrismaClient; redis: Redis; snapshotPath: string }): Promise<void>
//   boot: active PolicyVersion → else snapshot file → else DEFAULT_POLICY (log which one)
//   on first boot with no versions, seeds extraBlockedHosts from BLOCKED_HOSTS_EXTRA
//   refresh: Redis pub/sub channel 'policy:changed', plus a 60 s poll fallback
export async function publishPolicy(overrides: unknown, note: string, actorId: string): Promise<EffectivePolicy>
//   mergePolicy (422 on invalid) → tx: deactivate old, insert version+1 active → write snapshot → publish 'policy:changed' → AuditEvent
export async function activatePolicyVersion(version: number, actorId: string): Promise<EffectivePolicy>   // rollback
export function assertPlatformAllowed(platform: PlatformId, action: 'extract'|'download'|'playback'): void
//   AppError 403 SOURCE_PLATFORM_DISABLED
export function assertDownloadsOpen(): void          // AppError 503 MAINTENANCE or DOWNLOADS_PAUSED
// GET /api/v1/policy/public → PublicPolicy (Cache-Control: max-age=30)
```
Add `SOURCE_PLATFORM_DISABLED` to `INELIGIBLE_CODES`, with its copy.

- [x] **Step 1: Failing tests:**
  - `boot with DB down and snapshot present → snapshot policy`
  - `boot with DB down and no snapshot → DEFAULT_POLICY, never {}`
  - `publishPolicy invalid → 422, active version unchanged`
  - `publish → a second store instance on the same Redis sees the new version`
  - `platform tiktok disabled → POST /media/extract with a TikTok URL → 403 SOURCE_PLATFORM_DISABLED`
  - `maintenanceMode → POST /jobs → 503 MAINTENANCE`; extraction still works unless `extractionEnabled=false`
  - `FREE dailyDownloads overridden to 1 → second job → 429`
- [x] **Step 2:** Implement. The web pricing page (Phase 6 `billing`) reads tier limits from `/policy/public`, not from constants.
- [ ] **Step 3:** Tests pass, typecheck green. Commit `feat(api): runtime policy store and enforcement`. _(Tests + typecheck green; commit deliberately skipped at the user's request — changes are in the working tree.)_

---

# Phase 3 — Region-aware extraction (the safe approach to geo-locks)

### What we do and what we refuse to do

**The legitimate problem:** the content is available *in the user's own country*, but our server sits in another country and gets "not available in your country". The user could watch it themselves, so fetching it from a worker *in the user's region* doesn't widen access.

**The safe techniques we use:**
1. **Regional worker pools.** BullMQ queues `extract:<REGION>` and `download:<REGION>` are served by workers deployed in that region (for example, small VMs in `eu`, `us`, `in`, `bd`). A job is routed **only to the user's own region**, never to some other region.
2. **Trusted region signal.** The country comes from the CDN or edge (for example Cloudflare `CF-IPCountry`), and only when `TRUST_PROXY` is set and the request arrived through that proxy. Client-supplied headers are ignored otherwise.
3. **Honest UX.** If no worker exists in the user's region, or the content is geo-blocked *in the user's region too*, return `451 SOURCE_GEOBLOCKED`. The message is "This video isn't available in your region. The uploader or rights-holder restricts it." There is no workaround offered.

**What we refuse to do, and why:**
- Spoofing `X-Forwarded-For` (yt-dlp `--geo-bypass`). It's deceptive and breaks platform ToS.
- Rotating residential proxies or VPN pools to reach regions the user isn't in. That circumvents rights-holders' regional licensing and exposes the service to takedowns, account bans and liability.
- Using the user's login cookies, or ours. See Phase 2.

### Task 3.1: Region resolution

**Files:** Create `src/features/regions/region.ts`. Add env keys `REGION` (this deployment, e.g. `eu`), `WORKER_REGIONS` (csv), `COUNTRY_HEADER` (default `cf-ipcountry`) and `COUNTRY_TO_REGION` (a JSON map, e.g. `{"BD":"bd","IN":"in","DE":"eu"}`). Test: `test/features/regions/region.test.ts`.

**Interfaces:**
```ts
export type RegionCode = string;
export function resolveUserRegion(req: Pick<Request, 'headers' | 'ip'>, cfg: RegionConfig): RegionCode | null
export function pickRegionalQueue(userRegion: RegionCode | null, cfg: RegionConfig): string | null
// returns `extract:${userRegion}` only if userRegion ∈ WORKER_REGIONS and ≠ cfg.REGION; else null
```

- [ ] **Step 1: Failing tests:**
  - `ignores country header when TRUST_PROXY is false` → null
  - `maps BD → bd`
  - `unknown country → null`
  - `pickRegionalQueue never returns a region different from the user's` (property-style loop over every pair)
  - `same region as server → null`, so the extraction runs locally
- [ ] **Step 2:** Implement, run the tests, commit `feat(api): user region resolution`.

### Task 3.2: Regional retry on geo-block

**Files:** Create `src/features/regions/regional-extract.ts`. Modify `src/routes/media.routes.ts` (`POST /extract`) and `src/queue/queues.ts` (regional queue factory). Modify `src/queue/worker.ts` so it consumes `extract:${env.REGION}` when `WORKER_ROLE` includes `extract`.

**Interfaces:**
```ts
export async function extractWithRegionalFallback(source: NormalisedSource, userRegion: RegionCode | null): Promise<ExtractionRecord>
// 1) local extract; 2) on SOURCE_GEOBLOCKED and pickRegionalQueue(...) !== null →
//    enqueue on that queue, await QueueEvents.waitUntilFinished with 25_000 ms timeout; 3) else rethrow 451
```

- [ ] **Step 1: Failing tests** (fake the queue):
  - `geo-blocked + user region has worker → returns regional result`
  - `geo-blocked + no regional worker → 451 SOURCE_GEOBLOCKED`
  - `regional timeout → 504 with code SOURCE_TIMEOUT`
  - `non-geo errors never trigger regional retry`
- [ ] **Step 2:** Implement it. The download job records the region it was extracted in (`Job.region String?`, added via a migration) so the download runs in the same region, because signed URLs are region-bound.
- [ ] **Step 3:** Tests should pass. Commit `feat(api): regional extraction fallback for geo-blocked media`.

---

# Phase 4 — Backend hardening

### Task 4.1: `/healthz` and tool checks
**Files:** `src/features/health/*`.
- [ ] `GET /healthz` returns `{ status: 'ok'|'degraded'|'down', db, redis, tools: { ytDlp, ffmpeg, ffprobe }, region }`. Tool versions are read once at boot with `--version` (5 s timeout). If a tool is missing, log a **startup warning**; the worker still runs and refuses jobs with `ENGINE_UNAVAILABLE`.
- [ ] Tests: `reports degraded when db down`, `reports tool missing as null version`. Commit.

### Task 4.2: Keep yt-dlp fresh
- [ ] A worker cron (BullMQ repeatable job, daily at 04:00 local) runs `yt-dlp -U` when `YTDLP_AUTO_UPDATE=true`, then re-reads the version for `/healthz`. Extractors break weekly, so this is the most important ops task. Commit.

### Task 4.3: Artifact cleanup + storage cap
- [ ] A repeatable job runs every 15 min and deletes files whose `Job.expiresAt < now()`. If `STORAGE_DIR` grows past `STORAGE_MAX_GB` (default 20), it refuses new jobs with `STORAGE_FULL`. Test with a temp dir. Commit.

### Task 4.4: Code-review pass
- [ ] **Review gate** `[agent · opus · high]`: run the `code-review` / `security-review` skills over Phases 0-4. Fix the findings, then commit.

---

# Phase 5 — Frontend foundation + design system

Run the **`impeccable`** skill (shape → direction) and **`frontend-design`** before writing any UI. Use **`ui-ux-pro-max`** for palette and type validation, and **`motion-design` / `motion-patterns` / `animate`** in Phase 7. The direction below is the starting brief for those skills, not a substitute for them.

### Design direction: "Studio Console"

The product is a precise media tool, so the interface should feel like a well-built piece of studio hardware: calm, dark, tactile, with one warm signal colour that means "live / ready / recording".

- **Palette.** Warm charcoal surfaces `#0E0D0C → #1A1917 → #252320`. Text `#F2EEE8` / muted `#A39E95`. A single **signal amber** `#FFB224` for the primary action and progress. Semantic colours: success `#3DD68C`, danger `#FF6B5E`. A light theme mirrors it on warm paper `#F7F4EE`. No purple gradients, no glassmorphism stacks.
- **Type.**
  - *Display:* **Fraunces** (variable, opsz) for media titles and hero only. It gives an editorial feel, because media is content.
  - *UI:* **Geist Sans**.
  - *Numerics:* **Geist Mono** with `tabular-nums` for bytes, speed, ETA and resolution badges, so numbers don't jitter while they count.
- **Signature element.** The paste field is a large "input deck". On a valid URL it "seats", which is a spring settle (see Phase 7), and the platform glyph slides in. Format choices look like hardware selector keys: tactile press, with a locked state showing a small padlock and the required tier.
- **Density.** Generous on the home screen, compact and data-rich in the format picker and job list.
- **Accessibility floor.** WCAG 2.2 AA contrast, visible 2 px amber focus rings, every control reachable by keyboard, 44 px minimum touch targets.

### Task 5.1: Scaffold `apps/web`
**Files:** create `apps/web` (`package.json` name `@media/web`, `next.config.ts`, `tsconfig.json` extends `../../tsconfig.base.json`).
- [ ] `npx create-next-app@latest apps/web --ts --tailwind --app --src-dir --eslint --no-import-alias`, then rename the package to `@media/web` and add `"@media/shared": "*"`.
- [ ] In `next.config.ts`, add `rewrites: /api/v1/:path* → ${API_INTERNAL_URL}/api/v1/:path*`. This makes the refresh cookie (path `/api/v1/auth`) same-origin, so no CORS gymnastics are needed.
- [ ] `transpilePackages: ['@media/shared']`.
- [ ] Add `web` back to the root `dev` script (`"npm run dev -w @media/web"`, colour green). Make sure `CORS_ORIGINS` includes `http://localhost:3000`.
- [ ] **Verify:** `npm run dev` → http://localhost:3000 renders. Commit `feat(web): scaffold next app`.

### Task 5.2: Tokens + primitives
**Files:** `src/design/tokens.css` (CSS variables in a Tailwind v4 `@theme`), `src/design/motion.ts` (Phase 7 tokens, added now so primitives use them), `src/components/ui/{Button,Card,Badge,Progress,Toast,Sheet,Skeleton}.tsx` (Radix where interactive).
- [ ] Build a `/dev/tokens` page that renders every token and primitive in light and dark (dev-only route). Commit.

### Task 5.3: Data layer
- [ ] `src/lib/api.ts`: a typed `fetch` wrapper that parses `AppError` JSON into `ApiError { status, code, message }`, and does one silent refresh-and-retry on 401 via `POST /api/v1/auth/refresh`.
- [ ] Add a TanStack Query provider. Query keys: `['media', mediaId]`, `['job', jobId]`, `['jobs']`, `['quota']`, `['me']`. Commit.

---

# Phase 6 — Frontend features (feature-sliced)

Each feature folder exposes `index.ts` only. Routes in `src/app/` compose features and contain no logic.

| Feature | Route(s) | API used | Key states to design |
|---|---|---|---|
| `extract` | `/` | `POST /api/v1/media/extract` | idle, typing, invalid URL, extracting (skeleton), refused (`SOURCE_*` copy from `INELIGIBLE_COPY`), degraded banner |
| `formats` | `/m/[mediaId]` (SSR + OG tags from `GET /media/:mediaId`) | extract result | grouped Video / Audio-only / Subtitles; locked formats show tier + upsell; `recommendedFormatId` preselected |
| `player` | inside `/m/[mediaId]` | `POST /media/playback`, subtitles route | poster → playing; HLS via `hls.js` when `protocol` is `hls`; subtitle selector |
| `jobs` | `/jobs`, toast tray globally | `POST /jobs`, `GET /jobs/:id` (poll 1000 ms while active, stop when terminal), `POST /jobs/:id/cancel`, `GET /jobs/:id/artifact` | queued → extracting → downloading (bytes/speed/ETA) → processing → completed (download button) / failed (typed reason) / cancelled |
| `auth` | `/login`, `/register` | `/auth/*` | field errors, degraded-mode 503 message |
| `billing` | `/pricing`, `/account/billing` | `/billing/plans`, `/checkout`, `/portal`, `/subscription` | GUEST / FREE / PRO comparison (`maxHeight` 720 / 1080 / 8K) |
| `history` | `/account/history` | `GET /jobs`, `/jobs/quota` | quota meter (used / limit, resets-at) |

### Task 6.x (one per feature, same shape)
- [x] Build the components with every state in the table, using mock data on the `/dev/<feature>` route.
- [x] Wire them to the real API.
- [x] Add a Playwright spec `e2e/<feature>.spec.ts`. The happy path for `extract`→`formats`→`jobs` uses a public, Creative-Commons test video, for example Blender's "Big Buck Bunny" on YouTube or Vimeo. Add a refusal spec for a fixture-mocked `SOURCE_PRIVATE` response (`page.route` intercept).
- [ ] Commit per feature: `feat(web): <feature>`.

Copy rules: refusals use `INELIGIBLE_COPY` verbatim. Never blame the user. Always say what they *can* do ("Try a public link" / "Upgrade to Pro for 4K").

---

# Phase 7 — Motion system

Use the **`motion-design`**, **`motion-patterns`**, **`animate`** and **`emil-design-eng`** skills while implementing. Use **`review-animations`** at the end. Library: `motion` (`import { motion, AnimatePresence, MotionConfig } from 'motion/react'`).

### 7.0 Motion tokens (`apps/web/src/design/motion.ts`)

```ts
export const duration = { instant: 0.08, fast: 0.15, base: 0.22, slow: 0.32 } as const;      // seconds
export const ease = { out: [0.22, 1, 0.36, 1], inOut: [0.65, 0, 0.35, 1], exit: [0.4, 0, 1, 1] } as const;
export const spring = {
  snappy: { type: 'spring', stiffness: 520, damping: 34, mass: 0.8 },  // presses, toggles, selector keys
  gentle: { type: 'spring', stiffness: 260, damping: 28 },             // cards, sheets, layout
  settle: { type: 'spring', stiffness: 380, damping: 22 },             // the one "seat" moment (slight overshoot)
  progress: { type: 'spring', stiffness: 120, damping: 24 },           // progress bar width, follows data smoothly
} as const;
export const stagger = { list: 0.035, grid: 0.05, maxItems: 8 } as const; // items past 8 appear with the 8th
```

### 7.1 Choreography spec (every motion has a purpose)

| Moment | Motion | Values | Purpose |
|---|---|---|---|
| Route change | fade + 8 px rise in; fade out | enter `duration.base` `ease.out`; exit `duration.fast` `ease.exit` | Orientation, no blank flash |
| Paste valid URL → "seat" | input deck scales 0.98 → 1, platform glyph slides x −12 → 0 | `spring.settle` | Confirms recognition (the signature moment, **once** per paste) |
| Extracting | skeleton shimmer (opacity 0.5 ↔ 0.8, 1.2 s loop); no spinner | CSS keyframes | Signals work without distraction |
| Results arrive | metadata card fades in, then format keys **stagger** in (y 6 → 0, opacity) | `stagger.list`, `spring.gentle` | Reveals hierarchy: title first, then options |
| Selector key press | scale 0.97 while pressed → spring back | `spring.snappy` | Tactile feedback |
| Locked format tap | 2-step x shake (±3 px) + padlock tooltip | `duration.fast` | Explains *why* without a modal |
| Job card added to tray | `layout` animation pushes siblings; card slides in from the right edge | `spring.gentle`, `AnimatePresence mode="popLayout"` | Spatial continuity |
| Progress | width via `scaleX` (transform-origin left), driven by `spring.progress`; numbers update with tabular figures (no animation) | — | Smooth even with 1 s polling gaps |
| Job completed | bar flashes success colour (opacity pulse once), download button springs in (scale 0.9 → 1) | `spring.settle` | Earned moment |
| Job failed | card border fades to danger, *no* shake | `duration.base` | Calm; errors shouldn't feel punitive |
| Toast | in: y 16 → 0 + fade; out: fade + y 8 | `spring.gentle` / `duration.fast` | — |
| Sheet / dialog | backdrop fade; panel y 24 → 0 | `spring.gentle`; exit `duration.fast` | — |
| Degraded banner | height via `clip-path` reveal, not `height` | `duration.base` | Avoids layout thrash |

Don't animate: typing in inputs, numbers counting, table sorting, anything that repeats every second, or anything during scroll on the job list.

### Tasks
- [ ] **7.1** Wrap the app in `<MotionConfig reducedMotion="user">` and add `src/design/use-motion-safe.ts`, which returns opacity-only variants (≤ `duration.fast`) when reduced motion is on.
- [ ] **7.2** Implement the table row by row, one commit per row group (navigation, extract, formats, jobs, overlays).
- [ ] **7.3 Performance check:** in Chrome DevTools → Performance, at 4× CPU throttle, with 10 jobs updating there should be no frames over 16 ms and no layout shifts (CLS 0). Only `transform`/`opacity`/`clip-path` should appear in the Animations panel.
- [ ] **7.4 Playwright reduced-motion test:** `test.use({ reducedMotion: 'reduce' })`. Paste a URL, then assert that the input deck's computed `transform` is `none` throughout, and that the result card reaches opacity 1 within 200 ms.
- [ ] **7.5** Run the `review-animations` skill, then fix and commit.

---

# Phase 8 — Admin console

The admin controls everything the policy allows: restrictions, platforms, tiers, takedowns, users, jobs, the audit log and (in Phase 9) content. It reuses the Studio Console design system at higher density: tables and side sheets, no hero moments. Motion is limited to Phase 7's `spring.snappy` presses and its sheet and toast transitions. Nothing decorative.

### Task 8.1: Roles + admin guard  `[native · sonnet · medium]`

**Files:** A Prisma migration adds `enum Role { USER EDITOR ADMIN }`, `User.role Role @default(USER)` and `User.disabledAt DateTime?`. Create `features/admin/require-role.ts`. Modify `prisma/seed.ts` to promote `ADMIN_EMAIL` to ADMIN (dev only). Test: `test/features/admin/require-role.test.ts`.

**Interfaces:**
```ts
export function requireRole(...roles: Role[]): RequestHandler
// reads the role from the DB on every admin request (not from the JWT), so a demotion takes effect immediately;
// 401 if anonymous, 403 FORBIDDEN otherwise; a disabled user → 403 ACCOUNT_DISABLED
```
Rules:
- EDITOR can use `/admin/cms/*` only. ADMIN can use everything.
- An admin can't demote or disable themselves, and the last ADMIN can't be demoted.
- Every mutating admin request writes an `AuditEvent { actorId, action, target, before, after }`.
- Admin routes get their own rate limit (60/min/user) and sit behind `requireDatabase`.

- [ ] **Step 1: Failing tests:**
  - `anonymous → 401`
  - `USER → 403`
  - `EDITOR on /admin/policy → 403`
  - `EDITOR on /admin/cms/pages → 200`
  - `demoted mid-session → next request 403`
  - `last admin cannot be demoted → 409`
- [ ] **Step 2:** Implement, run the tests, commit `feat(api): roles and admin guard`.

### Task 8.2: Admin API  `[native · sonnet · medium]`

**Files:** `features/admin/{policy,takedowns,users,jobs,audit}.admin.ts`, mounted at `/api/v1/admin`. A Prisma migration adds `model Takedown { id, mediaId String @unique, sourceUrl, reason, status (PENDING|ACTIVE|REJECTED), requesterEmail?, createdAt, decidedById? }`. `evaluateEligibility` gains a takedown check (active `Takedown` for the `mediaId`) → `SOURCE_TAKEN_DOWN`; add it to the shared codes. Tests: one file per router.

| Endpoint | Does |
|---|---|
| `GET /admin/policy` | `{ active: EffectivePolicy, defaults, hardFloor, versions: [{ version, note, createdBy, createdAt, active }] }` |
| `POST /admin/policy` | body `{ overrides, note }` → `publishPolicy` (422 when invalid) |
| `POST /admin/policy/:version/activate` | rollback |
| `POST /admin/policy/preview` | body `{ overrides, url, tier }` → `{ active: Verdict, draft: Verdict }`. Runs normalise + eligibility + limits against both policies, using cached metadata. It never downloads. |
| `GET/POST/PATCH /admin/takedowns` | list / create / approve or reject |
| `GET /admin/users?q=&tier=&role=&cursor=` · `PATCH /admin/users/:id` | search; set `tier`, `role`, `disabledAt` |
| `GET /admin/jobs?state=&cursor=` · `POST /admin/jobs/:id/cancel` | live job list, cancel |
| `GET /admin/audit?actor=&action=&cursor=` | audit log |
| `GET /admin/stats` | jobs today by state, extracts by platform, refusals by code (last 24 h), queue depth, `/healthz` summary |

- [ ] **Step 1:** Failing tests per router: happy path, validation 422, audit row written, pagination cursor stable.
- [ ] **Step 2:** Implement, run the tests, commit `feat(api): admin endpoints`.

### Task 8.3: Admin shell + dashboard (web)  `[agent · sonnet · medium]` (large UI surface)

**Files:**
- `src/app/(admin)/admin/layout.tsx`: server-side `GET /me` role check, redirecting to `/login`. The API stays the real guard.
- `src/features/admin/shell/`: sidebar with Dashboard, Restrictions, Sites, Tiers, Takedowns, Users, Jobs, Audit, Content.
- `src/features/admin/dashboard/`: stat tiles and a refusals-by-code bar list from `/admin/stats`. Use the `dataviz` skill.

- [ ] Build with mock data on `/dev/admin`, wire to the API, add Playwright `e2e/admin-guard.spec.ts` (USER is redirected; ADMIN sees the sidebar). Commit.

### Task 8.4: Restrictions editor (web)  `[agent · sonnet · high]` (the riskiest admin screen)

**Files:** `src/features/admin/{policy,sites,tiers}/`.

- **Restrictions:** global switches (maintenance, extraction, downloads), limits, and extra blocked hosts (chip input with host validation).
- **Sites:** one row per platform with Enabled / Download / Playback toggles, max height and a note.
- **Tiers:** a tier × limit grid of numeric inputs (bytes shown in MB).
- **Hard floor:** shown read-only at the top with a padlock and the copy "These rules are enforced in code and can't be changed here: private, members-only, login-required, DRM, and DRM-only platforms."
- **Draft → review → publish:**
  - Edits build a draft overrides object, kept in `sessionStorage` so a reload doesn't lose it.
  - "Review changes" opens a sheet with a field-level diff (active vs draft), a **Test a URL** box that calls `/admin/policy/preview` and shows both verdicts side by side, and a required note.
  - Publishing shows any 422 field errors inline, next to the field.
  - A **History** tab lists versions with "Roll back to this".

- [ ] Playwright `e2e/admin-policy.spec.ts`: disable TikTok → publish → as a normal user, extracting a TikTok URL shows the `SOURCE_PLATFORM_DISABLED` copy within 5 s → roll back → it works again. Commit.

### Task 8.5: Takedowns, users, jobs, audit screens (web)  `[agent · haiku · medium]` (repetitive table + sheet CRUD on the patterns from 8.3/8.4)

- [ ] One feature folder per screen, built on a shared `DataTable` (server cursor pagination, URL-synced filters) and `EditSheet`. Destructive actions (disable user, approve takedown, cancel job) use a confirm dialog that names the target. Commit per screen.

---

# Phase 9 — CMS + rich-text editor

Editors (role EDITOR or ADMIN) manage pages and content blocks. Pages are things like Terms, Privacy, DMCA, FAQ, About and help articles. Blocks are smaller pieces: the home hero subtitle, the announcement banner and refusal-message overrides. Content is stored as **Tiptap JSON** (the source of truth) plus **sanitised HTML** rendered at save time, so the public site never runs editor code.

### Task 9.1: `@media/rich-text` package + CMS API  `[native · sonnet · high]` (security-sensitive)

**Files:** Create `packages/rich-text/` (`@media/rich-text`) with `extensions.ts`, `render.ts`, `sanitize.ts`, `index.ts` and its own Vitest tests. Create `apps/api/src/features/cms/*`. Prisma:
```prisma
enum CmsStatus { DRAFT SCHEDULED PUBLISHED ARCHIVED }
model CmsPage {
  id             String      @id @default(cuid())
  slug           String      @unique
  title          String
  status         CmsStatus   @default(DRAFT)
  contentJson    Json
  contentHtml    String
  seoTitle       String?
  seoDescription String?
  ogImageId      String?
  publishAt      DateTime?
  publishedAt    DateTime?
  version        Int         @default(1)
  updatedById    String
  updatedAt      DateTime    @updatedAt
  createdAt      DateTime    @default(now())
  revisions      CmsRevision[]
}
model CmsRevision {
  id          String   @id @default(cuid())
  pageId      String
  page        CmsPage  @relation(fields: [pageId], references: [id], onDelete: Cascade)
  version     Int
  title       String
  contentJson Json
  authorId    String
  createdAt   DateTime @default(now())
  @@unique([pageId, version])
}
model CmsBlock {
  key         String   @id
  contentJson Json
  contentHtml String
  updatedById String
  updatedAt   DateTime @updatedAt
}
model CmsAsset {
  id        String   @id @default(cuid())
  key       String   @unique
  mime      String
  bytes     Int
  width     Int?
  height    Int?
  alt       String
  createdAt DateTime @default(now())
}
```

**Interfaces:**
```ts
// @media/rich-text
export const extensions: AnyExtension[]              // the ONE list, used by the editor (web) and the renderer (api)
export function renderHtml(doc: JSONContent): string // @tiptap/html generateHTML(doc, extensions) → sanitize
export function sanitize(html: string): string        // sanitize-html with the allow-list below
export const ALLOWED_STYLES: Record<string, RegExp[]> // color, background-color, text-align, font-family, font-size, line-height

// api routes
GET    /api/v1/cms/pages/:slug                       // public, PUBLISHED only → { title, html, seo, updatedAt }
GET    /api/v1/cms/blocks?keys=a,b                   // public
GET/POST/PATCH/DELETE /api/v1/admin/cms/pages[/:id]  // PATCH body includes `version`; a mismatch → 409 CMS_CONFLICT
POST   /api/v1/admin/cms/pages/:id/{publish|unpublish|schedule}   // schedule body { publishAt }
GET    /api/v1/admin/cms/pages/:id/revisions  ·  POST .../revisions/:version/restore
PUT    /api/v1/admin/cms/blocks/:key
POST   /api/v1/admin/cms/assets (multipart)  ·  GET /api/v1/admin/cms/assets?cursor=
```

**Sanitiser allow-list:**
- Tags: `p h1–h6 strong em u s sub sup mark span a ul ol li blockquote pre code hr br img table thead tbody tr th td colgroup col figure figcaption iframe div label input[type=checkbox][disabled]` (the last for task lists).
- `a[href]`: only `https:`, `http:`, `mailto:` and `#`. External links get `rel="noopener noreferrer nofollow"` forced.
- `img[src]`: only from `CMS_ASSET_ORIGIN`.
- `iframe[src]`: only `https://www.youtube-nocookie.com/embed/*` and `https://player.vimeo.com/video/*`.
- `style`: only `ALLOWED_STYLES` (colours as hex or rgb, font sizes 10–72 px, font families from the 8 allowed stacks, line height 1.0–2.4).
- `class`: only `text-align-*` and `cms-*`.
- Everything else is dropped.

**Uploads:**
- Maximum `CMS_MAX_UPLOAD_MB` (default 5). Check magic bytes (png, jpeg, webp, gif, avif).
- Re-encode with `sharp` to webp (gif stays gif) and strip EXIF. Store under `STORAGE_DIR/cms/`. `alt` is required.

A repeatable BullMQ job publishes `SCHEDULED` pages once `publishAt <= now()`.

- [ ] **Step 1: Failing tests** (`apps/api/test/features/cms/*.test.ts`, `packages/rich-text/test/sanitize.test.ts`):
  - XSS fixtures are neutralised with the text kept: `<img src=x onerror=alert(1)>`, `<a href="javascript:alert(1)">`, `<span style="position:fixed;background:url(x)">`, `<iframe src="https://evil.com">`, `<svg><script>`, and pasted MS Word HTML (`mso-*` styles).
  - `renderHtml(a doc using every mark and node)` keeps every allowed style.
  - `PATCH with a stale version → 409 CMS_CONFLICT`.
  - `publish → GET /cms/pages/:slug returns the html`; a `DRAFT` page → 404.
  - `restore revision 2 → contentJson equals revision 2, version increments`.
  - `an .exe renamed to .png → 415`.
- [ ] **Step 2:** Implement, run the tests, commit `feat(cms): content model, sanitiser and API`.

### Task 9.2: Rich-text editor component  `[agent · sonnet · high]` (the largest UI task in the plan)

**Files:** `apps/web/src/features/cms/editor/{RichTextEditor.tsx,Toolbar.tsx,BubbleMenu.tsx,SlashMenu.tsx}` and `extensions/{font-size.ts,line-height.ts,indent.ts}`. It uses `extensions` from `@media/rich-text` plus editor-only ones (Placeholder, CharacterCount, Dropcursor, Gapcursor, History). Custom extensions that change the stored JSON (font size, line height, indent) go into `@media/rich-text`, not the web app, so the renderer knows them.

**Styling options (every one of these is in the toolbar):**

| Group | Options |
|---|---|
| History | Undo, Redo |
| Block | Paragraph, Heading 1–6, Blockquote, Code block (with language select, lowlight), Horizontal rule |
| Text | Bold, Italic, Underline, Strikethrough, Inline code, Subscript, Superscript, Clear formatting |
| Font | Font family (8 stacks: Geist Sans, Fraunces, Geist Mono, system sans, system serif, Georgia, Inter, Arial), Font size (10–72 px), Line height (1.0–2.4) |
| Colour | Text colour, Highlight colour (a 16-swatch palette plus a custom hex picker, each with "reset") |
| Alignment | Left, Center, Right, Justify; Indent / Outdent |
| Lists | Bullet, Numbered, Task list (checkboxes) |
| Insert | Link (edit, remove, open in new tab); Image from the media library (alt, caption, width 25/50/75/100 %); Table (insert, add/remove row and column, merge/split cells, header row toggle); YouTube/Vimeo embed; Emoji; Special characters |
| View | Word and character count, Full-screen, Preview (rendered through `renderHtml`, exactly as the public page will look), HTML view (read-only, sanitised output) |

**Behaviour:**
- A bubble menu on text selection (marks, link, colour) and a `/` slash menu for blocks.
- All the standard keyboard shortcuts (Ctrl/⌘ + B, I, U, K, Z, Shift+Z, Shift+7, Shift+8…), with each shortcut shown in its toolbar button's tooltip.
- Pasting is sanitised (Word, Google Docs).
- The draft autosaves 5 s after the last change via PATCH with `version`. On a 409 it shows "Someone else edited this page", with *Reload* and *Overwrite* options.
- `beforeunload` warns when there are unsaved changes.
- The toolbar is keyboard navigable (`role="toolbar"`, roving tabindex), and every button has an `aria-label`.
- The editing surface uses the light "paper" palette even in the dark admin, so authors see the real page colours.

- [ ] Build on `/dev/editor` with a fixture document that uses every option. Add Playwright `e2e/cms-editor.spec.ts`, which applies each toolbar action and asserts the resulting HTML in Preview. Commit `feat(web): rich-text editor`.

### Task 9.3: CMS admin screens  `[agent · haiku · medium]` (CRUD on established patterns)

**Files:** `src/features/cms/{pages,blocks,media-library}/`. Routes: `/admin/content/pages`, `/admin/content/pages/[id]`, `/admin/content/blocks`, `/admin/content/media`.

- [ ] **Pages list:** status filter, search, slug, updated by/at.
- [ ] **Page editor:** title; slug (generated from the title, editable, uniqueness checked); SEO fields with character counters; OG image picker; status actions (Publish / Unpublish / Schedule); a revisions side sheet with diff and restore.
- [ ] **Blocks:** a list of known keys (`home.hero.subtitle`, `announcement.banner`, `refusal.<CODE>`), each opening the editor in compact mode.
- [ ] **Media library:** grid, drag-and-drop upload, required alt text, copy URL.
- [ ] Commit per screen.

### Task 9.4: Public rendering  `[native · sonnet · low]`

**Files:** `src/app/(site)/p/[slug]/page.tsx`, `src/app/(site)/{terms,privacy,dmca}/page.tsx` (each renders the CMS page with the same slug), `src/features/cms/render/{CmsContent.tsx,cms.css}`, `src/app/api/revalidate/route.ts`.

- [ ] Server-render the stored HTML with `dangerouslySetInnerHTML`. This is safe because `@media/rich-text` sanitised it on save, and it's sanitised again on read as defence in depth. `cms.css` styles every allowed element to the design system (Fraunces headings, 68ch measure, tables, code blocks).
- [ ] ISR: `revalidate: 300`, plus on-demand `revalidateTag('cms:<slug>')`. On publish, the API calls `POST ${WEB_INTERNAL_URL}/api/revalidate` with `REVALIDATE_SECRET`. While the API is down, Next keeps serving the last rendered page.
- [ ] The `announcement.banner` block renders as the global banner, using Phase 7's clip-path reveal. A `refusal.<CODE>` block, when present, overrides `INELIGIBLE_COPY` for that code.
- [ ] Playwright `e2e/cms-publish.spec.ts`: create a page with a heading, coloured text, a table and an image → publish → `/p/<slug>` shows all four. On the XSS fixture page, no script runs (`page.on('dialog')` never fires). Commit.

---

# Phase 10 — Quality, security, deploy

- [ ] **10.1 Tests in CI:** GitHub Actions running `npm ci` → `npm run typecheck` → `npm test --workspaces --if-present` → Playwright (web against a mocked API). The services are Postgres 16+ and Redis.
- [ ] **10.2 Dockerfiles:**
  - `apps/api/Dockerfile`: multi-stage build, `node:24-slim`, with yt-dlp + ffmpeg installed in the image and a non-root user. One image serves both `api` and `worker` (different `CMD`).
  - `apps/web/Dockerfile`: Next `output: 'standalone'`.
  - Verify with `docker compose up --build`, which should boot all services. Docker has to be installed on the machine first, or this runs in CI only.
- [ ] **10.3 Security:**
  - **Review gate** `[agent · opus · high]`: run the `security-review` skill, focusing on `/admin/*` authorisation and CMS sanitisation.
  - Confirm SSRF guards (`isPrivateHostname`) cover IPv6 and DNS-rebinding by resolving the host before calling yt-dlp.
  - Confirm rate limits cover `/media/extract`.
  - Confirm secrets come from env only.
- [ ] **10.4 Legal/UX pages:** seed CMS pages `terms` (users may download only content they own or have rights to), `privacy` and `dmca`, served at `/terms`, `/privacy` and `/dmca` (Task 9.4). The `/dmca` page embeds a takedown form that creates a `PENDING` `Takedown` (Task 8.2) for an admin to approve. Add a first-download rights checkbox, remembered per user. **Get a legal review of the copy before launch.**
- [ ] **10.5 Lockfile:** commit `package-lock.json`.
- [ ] **10.6 Final:** run `superpowers:verification-before-completion`, then `superpowers:finishing-a-development-branch`.

---

## Environment keys added by this plan (add them to `.env.example` as you go)

| Key | Phase | Default | Purpose |
|---|---|---|---|
| `SHEETS_SPREADSHEET_ID` | 1.5 | unset (off) | Sheets mirror target |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | 1.5 | unset | Path to the SA key JSON, outside the repo |
| `BLOCKED_HOSTS_EXTRA` | 2.4 | empty | Seeds `policy.global.extraBlockedHosts` on first boot (csv) |
| `REGION` | 3.1 | `local` | This deployment's region |
| `WORKER_REGIONS` | 3.1 | empty | Regions that have worker pools |
| `COUNTRY_HEADER` | 3.1 | `cf-ipcountry` | Trusted edge header |
| `COUNTRY_TO_REGION` | 3.1 | `{}` | Country → region JSON map |
| `WORKER_ROLE` | 3.2 | `extract,download` | Which queues this worker consumes |
| `YTDLP_AUTO_UPDATE` | 4.2 | `false` | Daily `yt-dlp -U` |
| `STORAGE_MAX_GB` | 4.3 | `20` | Storage cap |
| `POLICY_SNAPSHOT_PATH` | 2.4 | `./var/policy.snapshot.json` | Last-known-good policy for boots without a DB (gitignored) |
| `ADMIN_EMAIL` | 8.1 | unset | Seed promotes this user to ADMIN (dev/staging only) |
| `CMS_MAX_UPLOAD_MB` | 9.1 | `5` | Max image upload |
| `CMS_ASSET_ORIGIN` | 9.1 | `http://localhost:4000` | The only origin `img[src]` may use |
| `REVALIDATE_SECRET` | 9.4 | generate | Shared secret for API → web cache revalidation |
| `WEB_INTERNAL_URL` | 9.4 | `http://localhost:3000` | Where the API sends revalidate calls |
