# Bug Findings: Codebase Review

**Date:** 2026-11-26
**Branch reviewed:** `admin`
**Scope:** whole monorepo: `apps/api`, `apps/web`, `packages/shared`, `packages/rich-text`, infra (Docker, compose, CI), Prisma migrations.

**Baseline at time of review:**
- Typecheck: all workspaces pass.
- Unit tests: 462 pass.
- Lint: 1 error, in `apps/web/src/features/formats/hooks/useRightsAck.ts`.

**Verification legend**
- ✅ **Verified**: confirmed by reading the source.
- 🔎 **Reported**: found by the review pass and not yet re-checked line by line. Line numbers marked `~` are approximate.

All paths are relative to the repo root unless noted.

---

## 0. Immediate action required

### 0.1 CRITICAL: GCP service-account private key committed to git history ✅
- **File:** `downloader-515907-821806c6fdc2.json`, a service account for Google Sheets (key id `821806c6…`).
- **Commit:** `226ff7b` ("build fully , now improvising admin"). The only branch containing it is the local `fix-errors` branch, which is 9 commits ahead of `origin/fix-errors`, so the key has **not been pushed**. It is not in `admin` HEAD, and `.gitignore` now ignores the file.
- **Risk:** a single `git push origin fix-errors`, or a merge of that branch, publishes a working private key.
- **Fix:**
  1. Revoke and rotate the key in the GCP console now.
  2. Purge it from history before any push: `git filter-repo --path downloader-515907-821806c6fdc2.json --invert-paths`. This rewrites the branch's history.
  3. Keep credentials outside the repo directory.

---

## 1. API: core (`apps/api/src`: lib, middleware, routes, services, queue)

### High

#### 1.1 SSRF in the subtitle proxy ✅
- **Location:** `apps/api/src/routes/media.routes.ts:160-185`, `apps/api/src/services/stream.service.ts:95-109`.
- **Problem:** `assertFetchableUrl` only checks the literal hostname with `isPrivateHostname`. There is no DNS resolution, and `fetch(..., { redirect: 'follow' })` follows redirects without re-checking them.
- **Scenario:** a public hostname that resolves to, or 302-redirects to, `169.254.169.254` or an internal service gets fetched. For unknown extensions `toWebVtt` falls back to `WEBVTT\n\n${body}`, so the internal response body is returned to the caller. The route is open to guests.
- **Also:** `upstream.text()` reads the whole body before the 5 MB check whenever `content-length` is absent.
- **Fix:**
  - Call `assertHostResolvesPublic`.
  - Use `redirect: 'manual'` and re-validate every hop.
  - Cap the bytes as the body streams in.

#### 1.2 Artifact download returns 500 for non-Latin1 titles ✅
- **Location:** `apps/api/src/routes/jobs.routes.ts:262`, `apps/api/src/queue/worker.ts:~646-655`.
- **Problem:** the quoted `filename="${fileName}"` part of `Content-Disposition` contains the raw title. Node's `setHeader` throws `ERR_INVALID_CHAR` for characters above U+00FF.
- **Scenario:** any CJK, Bengali, Arabic, Cyrillic or emoji title gives a 500, so the user can never download the finished file.
- **Fix:** make `filename=` an ASCII-folded fallback and keep the UTF-8 name only in `filename*=`.

#### 1.3 Stripe webhook claim treats every DB error as a duplicate ✅
- **Location:** `apps/api/src/services/billing.service.ts:137-145`.
- **Problem:** `claimWebhookEvent` catches every error and returns `false`, so the handler replies 200 `duplicate: true`. The webhook is mounted outside `requireDatabase`.
- **Scenario:** during a Postgres outage Stripe receives 200s and never retries, so paid subscriptions are silently lost.
- **Fix:** treat only Prisma `P2002` as a duplicate and rethrow everything else. That produces a 500, and Stripe retries.

#### 1.4 Out-of-order or stale webhooks overwrite newer subscription state 🔎
- **Location:** `apps/api/src/routes/billing.routes.ts:~236-241`, `apps/api/src/services/billing.service.ts:~349-393`.
- **Problem:** `subscription.created`, `updated`, `paused` and `resumed` are applied from the event snapshot.
- **Scenarios:**
  - A delayed older `updated` (active) event that arrives after `deleted` re-grants PRO indefinitely.
  - `handleSubscriptionDeleted` resets the user to FREE without checking that the deleted subscription is the current one. A user who re-subscribed is downgraded when the old subscription's delete event lands.
- **Fix:** retrieve the live subscription from Stripe (as the checkout and invoice paths already do), or compare `event.created`. Match `stripeSubscriptionId` before downgrading.

### Medium

#### 1.5 Webhook is claimed before it is processed 🔎
- **Location:** `apps/api/src/routes/billing.routes.ts:~203-219`.
- **Problem:** the claim row is committed before `processEvent` runs.
- **Scenario:** if the process dies, or the `delete` on the 500 path fails, Stripe's retry is acknowledged as a duplicate and the event is lost.
- **Fix:** store a "processing" or "done" state on the claim row, or make the handlers idempotent and drop the claim row.

#### 1.6 Guests can bypass the extraction rate limit and cap 🔎
- **Location:** `apps/api/src/middleware/rate-limit.ts:~358-363`, `apps/api/src/routes/jobs.routes.ts:~74`, `apps/api/src/routes/media.routes.ts:~400`.
- **Problems:**
  - The guest limiter is keyed on the `guest:<cookie-uuid>`. Dropping the cookie gives a fresh bucket each time, leaving only the global 300/min per-IP limit.
  - `POST /jobs` and `/media/playback` can spawn yt-dlp on a cache miss without going through `extractionRateLimit`.
- **Fix:** add an IP-keyed ceiling for guests, and apply the extraction limiter on cache misses in all three paths.

#### 1.7 Enqueue error handling gets quota wrong 🔎
- **Location:** `apps/api/src/routes/jobs.routes.ts:~105-164`.
- **Problems:**
  - If `enqueueMediaJob` throws after `prisma.job.create`, the quota is released but a phantom QUEUED row stays forever.
  - A failure after the enqueue (`toJobSummary` or `getQuotaSnapshot`) also releases the quota and returns 500, while the job still runs. The user gets a free download plus an error.
- **Fix:** mark the row FAILED (or delete it) when the enqueue fails, and move the post-enqueue work out of the `try`.

#### 1.8 Long downloads are killed by the stdout cap ✅
- **Location:** `apps/api/src/lib/exec.ts:114-127`, `apps/api/src/queue/worker.ts:504`.
- **Problem:** `runCommand` counts and buffers all stdout even when `onStdoutLine` is set. The worker passes `maxOutputBytes: 4 MB`, and yt-dlp prints a progress line on every tick.
- **Scenario:** long or fragmented downloads cross 4 MB of progress output, get killed, and fail with a generic error.
- **Fix:** when a line callback is set, don't accumulate stdout or count it against the limit (or cap only the retained string).

#### 1.9 Gaps in child-process cleanup ✅
- **Location:** `apps/api/src/lib/exec.ts:~100,111`.
- **Problems:**
  - After SIGTERM, `child.killed` is already `true`, so `if (!child.killed) child.kill('SIGKILL')` never runs. A process that ignores SIGTERM keeps running.
  - An `AbortSignal` that is already aborted when the call starts never fires its listener.
- **Fix:** track exit with the `close` event, and check `signal.aborted` up front.

#### 1.10 Abort-on-disconnect probably doesn't work 🔎
- **Location:** `apps/api/src/routes/media.routes.ts:~336`.
- **Problem:** `req.on('close')` fires when the request body has been consumed, not when the client disconnects. It is attached after an `await`, so it has probably already fired.
- **Fix:** `res.on('close', () => { if (!res.writableEnded) controller.abort(); })`.

#### 1.11 Artifact file stream leaks on client disconnect 🔎
- **Location:** `apps/api/src/routes/jobs.routes.ts:~267-272`.
- **Problem:** `stream.pipe(res)` leaves the file descriptor open when the client aborts.
- **Fix:** `await pipeline(stream, res)` from `stream/promises`, and catch its rejection.

#### 1.12 Stalled or failed BullMQ jobs leave DB rows stuck 🔎
- **Location:** `apps/api/src/queue/worker.ts:~714-716`.
- **Problem:** the `failed` handler only logs. A job that exceeds `maxStalledCount` leaves its row in DOWNLOADING or QUEUED, and its quota and concurrency slots stay held for up to 2 h.
- **Fix:** in the `failed` handler, mark the row FAILED and call `release()` if it isn't already in a terminal state.

#### 1.13 Refresh-token rotation race with no grace window 🔎
- **Location:** `apps/api/src/services/token.service.ts:~97-138`, `apps/api/src/routes/auth.routes.ts:~485-490`.
- **Problems:**
  - Check, issue and update are not atomic, so two concurrent refreshes both succeed.
  - A near-simultaneous refresh from a second tab is treated as token theft, which revokes the whole token family and signs the user out everywhere.
  - Cookies are cleared on any error, including transient DB errors.
- **Fix:**
  - Use `updateMany({ where: { id, revokedAt: null } })` and check the count.
  - Add a short reuse grace window.
  - Clear cookies only on 401/403.

#### 1.14 Signed-in users get a 500 during a DB outage 🔎
- **Location:** `apps/api/src/middleware/identity.ts:~188-211`.
- **Problem:** `refreshTierFromDb` lets Prisma errors through on `/media/extract` and `/media/playback`, which are meant to stay usable in degraded mode.
- **Fix:** check `getDbHealth().up` and fall back to the tier in the JWT, or return 503 `DEGRADED`.

#### 1.15 Cancel race in `removeQueuedJob` 🔎
- **Location:** `apps/api/src/queue/queues.ts:~498-503`.
- **Problem:** `getState()` followed by `remove()` is a check-then-act race. If the worker locks the job in between, the cancel returns 500 and the cancel flag is never set.
- **Fix:** catch the error, treat it as "not removed", and still set the cancel flag.

### Low

| # | Finding | Location | Fix |
|---|---|---|---|
| 1.16 | Body-parser errors (413, bad charset) are mapped to 500 | `middleware/error-handler.ts:~79-86` | Honour `err.status` when `err.expose` is true |
| 1.17 | The first requester's raw `sourceUrl`, including private query tokens, is cached and served unauthenticated by `GET /media/:mediaId` | `services/extraction.service.ts:~479` | Store the canonical URL instead |
| 1.18 | Error classification: "not found" is matched before ffmpeg-not-found, so a missing ffmpeg fails permanently; the "premium" and "age"+"confirm" substrings are too broad | `queue/worker.ts:~584-593`, `extraction.service.ts:~424-430` | Reorder and tighten the matchers |
| 1.19 | The full `process.env`, including JWT, Stripe and DB secrets, is passed to yt-dlp and ffmpeg, which handle hostile input | `lib/exec.ts:~68` | Pass an allowlisted env |
| 1.20 | CSRF check is skipped when there is no access cookie, so `/auth/refresh` and `/auth/logout` rely only on SameSite=Lax; the comparison is not timing-safe | `middleware/identity.ts:~229-237` | Always check on state-changing auth routes |
| 1.21 | Guest concurrency is keyed per cookie, so rotating the cookie bypasses `maxConcurrentJobs` | `services/quota.service.ts:~222` | Add an IP-keyed concurrency slot |
| 1.22 | Cancel releases the IP key from the cancelling request instead of the job's | `routes/jobs.routes.ts:~214` | Use the stored `ipHash` from the job payload |
| 1.23 | The cached `record.region` is shared across users, so jobs go to the first requester's regional queue | `extraction.service.ts:~217-222` | Resolve the region per request |
| 1.24 | URL canonicalisation drops `:80` for https and `:443` for http | `lib/source-url.ts:~801` | Drop only each scheme's own default port |
| 1.25 | The subtitle response is `cache-control: public` even though it is gated per tier and rule | `routes/media.routes.ts:~475` | Use `private` |
| 1.26 | A fractional `?limit=` reaches Prisma `take` and throws (verified ✅) | `routes/jobs.routes.ts:171`, `services/job.service.ts:110` | `Math.floor` / `parseInt` |

### Quality
- `keys.refreshBlock` in `lib/redis.ts` is dead code. Access tokens can't be revoked after logout-all or a password change, so they stay valid for up to 15 min.
- Request-id derivation is duplicated in `index.ts` and `middleware/identity.ts`.
- `/health` runs after `attachIdentity`, so every probe sets a guest cookie.
- `record.subtitleSources[lang]` is a plain object lookup. Use `Object.hasOwn`.
- `registerUser` returns 409 even though it claims not to reveal whether an account exists. It also hashes the password before the existence check.
- `/billing/plans` makes two live Stripe calls per request with no caching.
- `shutdown` awaits `stopYtDlpListener` before arming the force-exit timer.

---

## 2. API: feature modules (`apps/api/src/features/*`, `prisma/seed.ts`)

**Checked and found sound:**
- Admin authorization: `requireRole` re-reads the role from the DB on every request.
- CMS sanitization.
- Upload path handling: UUID names, byte sniffing, re-encoding.

### High

#### 2.1 Policy publish has no optimistic concurrency, and races surface as "database unavailable" 🔎
- **Location:** `features/restrictions/policy.store.ts:~238-262`, `features/admin/policy.admin.ts:~55-69`.
- **Problems:**
  - Two admins editing the same base version silently overwrite each other.
  - `aggregate(_max) + 1` under READ COMMITTED races, and the resulting `P2002` is turned into a misleading 503.
- **Fix:**
  - Add `baseVersion` to the publish body and return 409 when it doesn't match.
  - Map `P2002` to 409.
  - Use `pg_advisory_xact_lock` or Serializable isolation.

### Medium

| # | Finding | Location | Fix |
|---|---|---|---|
| 2.2 | `activate` and `publish` can leave two active policy rows | `policy.store.ts:~272-297` | Partial unique index `WHERE active`, or a shared advisory lock |
| 2.3 | The last-admin and self-demotion check is racy: two admins can demote each other and leave zero | `admin/require-role.ts:~49-74`, `users.admin.ts:~68-96` | Run the check and the update in one transaction with `FOR UPDATE` |
| 2.4 | Policy publish and activate write duplicate audit rows (store `recordAudit` plus route `setAudit`) | `policy.store.ts:~268,295`, `policy.admin.ts:~61,115` | Keep one of them |
| 2.5 | Admin audit is best-effort, written after the response; a committed mutation followed by an error leaves no audit row | `admin/audit.ts:~27-52`, `users.admin.ts:~96-106` | Write the audit row in the same transaction as the mutation, or via the ledger |
| 2.6 | Poison lines in the outbox (for example a P2003 FK violation) are retried forever | `persistence/outbox.ts:~225-240` | Classify permanent errors and move them to a dead-letter file |
| 2.7 | Outbox drain treats any `*.draining` file as crash leftovers, including another process's file that is still being read | `outbox.ts:~190-192` | Lease or PID in the name; skip files that are still fresh |
| 2.8 | Takedown intake: any earlier row, even a bogus PENDING one, blocks the rights holder's real notice; a REJECTED row blocks the media forever; there is a `P2002` race that gives 500 | `eligibility/takedown.public.ts:~31-43` | Store every request; reopen REJECTED rows; catch `P2002` and return 202 |
| 2.9 | Image decompression bomb: `sharp` uses the default `limitInputPixels` (about 268 M pixels) | `cms/cms.upload.ts:~41` | `limitInputPixels: ~40e6`, cap GIF `pages` |
| 2.10 | Scheduling a published page doesn't revalidate the web cache; a find-then-update race in `publishDuePages` skips the notification | `cms.admin.ts:~189-204`, `cms.publisher.ts:~11-13` | Call `notifyWeb` after scheduling; select the exact rows that were updated |
| 2.11 | CMS status transitions aren't validated (publish works on ARCHIVED) and don't bump `version` | `cms.admin.ts:~160-187` | Whitelist transitions; increment `version` |
| 2.12 | The seed creates `free@`/`pro@example.test` with password `Password123!` and no production guard | `prisma/seed.ts:~13-20` | Skip seeding users when `NODE_ENV=production` |

### Low

| # | Finding | Location |
|---|---|---|
| 2.13 | Admin cancel of a guest job doesn't release the IP quota (`ipSubject: null`) | `jobs.admin.ts:~68-72` |
| 2.14 | Admin cancel sets CANCELLED unconditionally, which can overwrite COMPLETED | `jobs.admin.ts:~57-67` |
| 2.15 | The storage sweep nulls `artifactPath` even when `rm` failed, orphaning the file | `maintenance/storage.ts:~124-127` |
| 2.16 | Policy preview ignores platform switches, `downloadsEnabled` and `maintenanceMode` | `admin/policy.preview.ts:~64-85` |
| 2.17 | Numeric policy overrides accept fractions and `Infinity`; there is no body size bound | `policy.schema.ts:~61-91` |
| 2.18 | CMS: revisions endpoint is unpaginated; `ogImageId` is never validated; files are orphaned if the DB insert fails; `notifyWeb` blocks the request for up to 3 s per slug | `cms.admin.ts`, `cms.upload.ts` |
| 2.19 | Admin stats mix a UTC calendar day with a rolling 24 h window under one `windowHours: 24` label | `stats.admin.ts:~14-24,48` |
| 2.20 | Takedown admin create and decide are check-then-write (500 instead of 409, last write wins); no decision timestamp | `takedowns.admin.ts:~52-81` |
| 2.21 | The Sheets mirror can append duplicate rows after a timeout; `stop()` drops queued rows | `sheets-sink.ts:~176-192,264-267` |
| 2.22 | `ensureEngineAvailable` probe race: jobs that arrive during a re-probe get ENGINE_UNAVAILABLE | `health/tool-versions.ts:~141-156` |
| 2.23 | `/healthz` is unauthenticated and discloses the yt-dlp and ffmpeg versions | `health.routes.ts:~67-73` |

### Quality
- `KEY` and `PLATFORM_IDS` are declared more than once. The `_RulesFit` and `_SchemaChecks` type aliases are unused.
- `defaultRuleMessage` and `verdictFor` duplicate the logic in `enforce.ts`.
- The Prisma JSON fields use `as never` casts, and `PolicyOverridesSchema` is cast through `unknown`.
- `Record<string, unknown>` is used for update data, which bypasses Prisma's type checks.
- The `audit()` helper in `policy.store.ts` is mis-indented and lazily imports `user.service`.

---

## 3. Web app (`apps/web/src`, `next.config.ts`)

**Checked and found sound:**
- The revalidate route: fails closed, uses `timingSafeEqual`.
- Manual redirect handling in the stream route.
- No open redirect in login.
- Every `dangerouslySetInnerHTML` receives sanitized input.
- The server-side admin role gate.

### Medium / High

| # | Finding | Location | Fix |
|---|---|---|---|
| 3.1 | Submitting the MediaPicker upload form (in a portal) bubbles to the Details `<form>` and saves the page metadata without the user asking | `features/cms/pages/PageEditor.tsx:~99,186`, `MediaGrid.tsx:~71` | Move the picker out of the form, or call `stopPropagation` |
| 3.2 | Autosave edits from the last 5 s are lost on client-side navigation, because unmount only clears the timer | `features/cms/editor/RichTextEditor.tsx:~191` | Flush on unmount when the editor is dirty |
| 3.3 | Lint error (`set-state-in-effect`) ✅; `acked` stays `null` if `/auth/me` errors, so Download stays disabled forever | `features/formats/hooks/useRightsAck.ts:18-23` | Rewrite with `useSyncExternalStore` (the pattern `jobs/store.ts` already uses) |
| 3.4 | The admin layout can't refresh an expired access token, so a hard reload redirects to `/login` even with a valid refresh token; logout doesn't leave protected routes | `app/(admin)/admin/layout.tsx:~9-23`, `useAuth.ts:~425-433` | Make the layout use a refresh-capable path; redirect on logout |
| 3.5 | The policy draft in sessionStorage has no version, so a stale draft is overlaid on a newer policy and can overwrite another admin's publish | `features/admin/policy/usePolicyDraft.tsx:~34-44` | Store the base version; warn or discard on mismatch |
| 3.6 | "Roll back to this" activates an old policy in one click with no confirmation | `features/admin/policy/HistoryTab.tsx:~38` | Wrap it in `ConfirmDialog` |
| 3.7 | Details form state goes stale after a revision restore or a conflict reload, and a later save overwrites the restored title | `PageEditor.tsx:~56-70` | `<Details key={page.version}>` |
| 3.8 | The invalidation key is wrong: `["admin","/admin/cms"]` never matches `["admin","/admin/cms/pages",qs]` | `PagesList.tsx:~21`, `admin/shared/useAdminAction.ts:~10` | Pass `"cms/pages"` |
| 3.9 | DNS-rebinding race in the stream proxy: the fetch re-resolves DNS after the check | `app/api/stream/[token]/route.ts:~36-50` | Pin the checked IP using an undici `Agent` lookup |
| 3.10 | Unbounded `res.text()` on manifests; upstream `text/html` or `svg` is served from the app's own origin | `route.ts:~88-104` | Cap the read while streaming; allow only media content types; add `CSP: sandbox` |
| 3.11 | The dashboard has no error state, so the skeleton shows forever | `features/admin/dashboard/Dashboard.tsx:~48` | Handle `isError` with a Retry button |
| 3.12 | Job polling never backs off and polls every 1 s even when errors persist | `features/jobs/hooks/useJobs.ts:~15` | Stop polling or back off on error |
| 3.13 | The "Added to your downloads" banner stays after the user picks a different format | `MediaScreen.tsx:~110`, `DownloadBar.tsx` | Reset the mutation when the selection changes |

### Low

| # | Finding | Location |
|---|---|---|
| 3.14 | The pager's "Previous" stack is lost on reload, deep link or Back | `admin/shared/useAdminList.ts:~33-57` |
| 3.15 | The EditUser and Disable dialogs keep cancelled values when reopened | `admin/users/Users.tsx:~47` |
| 3.16 | TextFilter doesn't resync with URL changes; Enter followed by blur applies the filter twice | `admin/shared/TextFilter.tsx` |
| 3.17 | a11y: `role="radio"` without roving tabindex or arrow keys; locked keys can still be activated | `FormatPicker.tsx:~62-72`, `PricingView.tsx:~162` |
| 3.18 | a11y: the `aria-live` region mounts together with its content, so it isn't announced | `JobToastTray.tsx:~55` |
| 3.19 | a11y: the Approve, Reject, Edit and Delete buttons have no row-specific labels | `Takedowns.tsx:~31`, `RuleList` |
| 3.20 | The `editor.on("blur")` listener is never removed | `cms/editor/SlashMenu.tsx:~54` |
| 3.21 | Unhandled clipboard rejection; `setTimeout` is not cleaned up | `MediaGrid.tsx:~125-130` |
| 3.22 | `crypto.randomUUID()` throws on plain-HTTP staging | `policy/rules/ruleModel.ts:~12` |
| 3.23 | `useReducedMotion` can cause a hydration mismatch in the SSR banner | `AnnouncementBanner.tsx`, `design/use-motion-safe.ts` |

### Quality
- **`slugTouched` is never false:** it starts as `true`, so the code that auto-fills the slug from the title never runs (`PageEditor.tsx:~58`).
- **`useSlugTaken` can miss a taken slug:** it does a fuzzy search capped at 20 results, so a slug that is taken can show as free.
- **Duplicated components:**
  - `Hosts` duplicates `HostChips`.
  - `IntInput` duplicates `NumberField`.
  - `Frame` is defined twice.
  - `HardFloor` and `LockedRules` render the same card.
- **EDITOR sees admin-only navigation:** users with the EDITOR role see the Users, Policy and Jobs links. This is UX only, because the API enforces access.

---

## 4. Packages, infra, CI, config

| # | Severity | Finding | Location | Fix |
|---|---|---|---|---|
| 4.1 | High ✅ | `.dockerignore` excludes only root `.env` files, so `apps/*/.env*` could end up in image layers; credential JSON is not excluded | `.dockerignore` | `**/.env*`, `!.env.example`, `*service-account*.json`, `downloader-*.json` |
| 4.2 | High | CI never runs lint; the API, shared and rich-text packages have no ESLint config at all | `.github/workflows/ci.yml` | Root flat config with typescript-eslint, plus a `lint` script per package and a CI step |
| 4.3 | Medium | API tests aren't type-checked (`include: ["src/**/*.ts"]`) | `apps/api/tsconfig.json:9` | Add `tsconfig.test.json` and run it in typecheck |
| 4.4 | Medium | The whole `.env`, including Stripe and JWT secrets, goes to every container, including `web` and the yt-dlp worker | `docker-compose.yml:58,78,100` | Give each service only the vars it needs |
| 4.5 | Medium | Postgres (`media/media`) and Redis (no password) are published on all interfaces | `docker-compose.yml:8-9` | Bind to `127.0.0.1`; read the password from env; add Redis `--requirepass` |
| 4.6 | Medium | `isPrivateHostname` accepts trailing-dot names (`localhost.`, `foo.internal.`) | `packages/shared/src/stream-token.ts:~167` | Strip trailing dots |
| 4.7 | Medium | IPv6 private-range check misses `2002::/16` (6to4), `2001::/32` (Teredo), `2001:db8::/32` and `100::/64` | `stream-token.ts:~229-241` | Add the ranges and decode the embedded IPv4 |
| 4.8 | Medium | `verifyStreamGrant` doesn't validate the payload shape (`null` gives a TypeError and a 500) and doesn't check that `host` matches `url` | `stream-token.ts:~117-129` | Validate with zod and assert host == URL hostname |
| 4.9 | Medium | A stale root Prisma stub (`prisma/schema.prisma` with 0 models, plus `prisma.config.ts`) means a `db push` run from the root could drop tables | repo root | Delete both |
| 4.10 | Medium | yt-dlp is `latest` and unverified in the image | `apps/api/Dockerfile:30-32` | Pin a tag and verify it against `SHA2-256SUMS` |
| 4.11 | Low | The worker inherits an API-port HEALTHCHECK, so it is always "unhealthy" | `apps/api/Dockerfile:51` | `healthcheck: disable: true` for the worker |
| 4.12 | Low | The runtime image ships devDependencies | `apps/api/Dockerfile` | `npm prune --omit=dev` (keep `prisma` and `dotenv`) |
| 4.13 | Low | Sanitizer hardening (no XSS found): `img` allows `http`; `cms-*` classes can be applied freely; iframe has no `sandbox` or `referrerpolicy` and `width`/`height` aren't validated; an empty `assetOrigin` silently drops every image | `packages/rich-text/src/sanitize.ts:53-72` | Force https; add sandbox; validate dimensions |
| 4.14 | Low | The `line-height` regex is redundant | `sanitize.ts:24` | Simplify it |
| 4.15 | Quality | tsconfig is missing `noImplicitReturns`, `noFallthroughCasesInSwitch` and `noUnusedLocals/Parameters`; the NodeNext settings in the base are dead (packages override to CommonJS); web doesn't extend the base | `tsconfig.base.json` | Tighten the flags |
| 4.16 | Quality | Migrations match the schema. Missing indexes: `AuditEvent(createdAt)`, `Job(state, createdAt)` | `apps/api/prisma/schema.prisma` | Add the indexes with a migration |
| 4.17 | Quality | `.env.example` defines `API_INTERNAL_URL` twice; the `change-me-…` secrets pass a length-only check in production; CI runs only on pushes to `main` and on PRs; there is no audit step or Docker build check | `.env.example`, `ci.yml` | Reject `change-me` when `NODE_ENV=production`; add CI steps |
| 4.18 | Quality | The vitest config has no timeouts and no file-parallelism control for the shared DB | `apps/api/vitest.config.mts` | `fileParallelism: false` for DB tests |
| 4.19 | Quality | Leftover `apps/api/tmp-worker-recheck-test/` | `apps/api/` | Delete it and add it to the ignore files |

**Checked and fine:**
- Stream-grant HMAC: `timingSafeEqual` with a length check, base64url, expiry checked.
- No sanitizer XSS bypass found.
- yt-dlp argv handling: no shell, `--` before the URL.
- JWT verification: issuer, audience and type are all checked.
- Job IDOR protection.
- Artifact path confinement.

---

## 5. Not reviewed
- The tier-limit logic in `packages/shared/src/{media,tiers,eligibility,rules}.ts`.
- The DNS-resolution path in `apps/api/src/lib/dns-guard.ts`.
- `apps/web` dev showcases, `mocks/`, and the CSS files, which were grepped only.

## 6. Suggested fix order
1. **Phase 0:** rotate the GCP key and purge it from history.
2. **Phase 1, security and money:** 1.1, 1.2, 1.3, 1.4, 1.6, 1.19, 2.9, 2.12, 3.9, 3.10, 4.6, 4.7.
3. **Phase 2, correctness:** the remaining High and Medium items in sections 1–3.
4. **Phase 3, infra and standards:** section 4.
5. **Phase 4, Low and Quality items.**
