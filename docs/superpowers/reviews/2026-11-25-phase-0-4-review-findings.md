# Phase 0–4 review findings

**Date:** 2026-11-25
**Branch:** `fix-errors`. Commits are on hold at the user's instruction, so the work is uncommitted on top of `2a3f4e4`.
**Plan:** `docs/superpowers/plans/2026-11-25-media-engine-recovery-and-frontend.md`
**Review:** an Opus code and security review of Phases 0–4 (`22bc4d7` to the working tree).
**Result:** 0 Critical, 8 Important (all upheld when I re-graded them), 5 Minor.

**Fix status:** all 8 Important findings are **fixed**. Each has a test that was seen failing first. I re-ran the checks myself: `npx vitest run` passes 214/214 across 20 files, `tsc --noEmit` is clean, and nothing is committed.

---

## Important findings (fixed)

### 1. Downloads ignore the user's region
- **Problem:** region routing is never used for downloads. Every download job goes to the main `media-jobs` queue. The download worker also starts whatever `WORKER_ROLE` says, so a machine set up only to extract still takes download jobs.
- **Effect:** a geo-blocked video can be extracted through a regional worker, but its download then runs from the main region and fails.
- **Fix:** start the download worker only when the role includes `download`, and route jobs to per-region queues named `media-jobs-<region>` (BullMQ doesn't allow `:` in queue names).

### 2. The regional fallback blocks itself
- **Problem:** the API takes the extraction lock and then hands off to the regional worker, which waits for the same lock.
- **Effect:** the first paste of a geo-blocked video ends in a 504.
- **Fix:** regional extraction skips the lock, because the API caller already holds it.

### 3. Refusals are miscached and mislabelled
- **Problems:**
  - A `GEOBLOCKED` refusal is cached per video for all users, so a video blocked in one region looks blocked everywhere.
  - Any regional failure is reported as `GEOBLOCKED`.
  - YouTube's "Sign in to confirm you're not a bot" message matches the "sign in" rule and is mapped to `SOURCE_PRIVATE`. That refusal is permanent, it gets cached, and the job isn't retried.
- **Effect:** users are refused public videos.
- **Fix:**
  - Stop caching `GEOBLOCKED`.
  - Check for the bot-check message before the generic "sign in" rule, map it to an existing retryable code, and never cache it.
  - Have the worker retry it.

### 4. Forged country header (security; plan Review Focus #4)
- **Problem:** with `TRUST_PROXY=true`, the `CF-IPCountry` header is trusted from any caller.
- **Effect:** any client can pick its region and get around region rules.
- **Fix:** add a new env var, `TRUSTED_PROXY_CIDRS`. The header is honoured only when the direct peer is in that list. **An empty list means the header is ignored (fails closed).** A deployment that relies on the header today must set this variable.

### 5. Per-platform switches and quality caps are skipped
- **Problem:** the platform comes from yt-dlp's extractor key, which has variants such as `twitchvod` and `facebookreel`. Those names have no policy entry, and the worker's `tierPolicyFor` isn't passed the platform at all.
- **Effect:** turning a platform off, or capping its quality, doesn't apply to its variant URLs or to the worker-side check.
- **Fix:** take the platform from the URL's host, with a prefix map for the variants, and pass it to the worker's `tierPolicyFor`.

### 6. One slow startup probe stops all jobs
- **Problem:** if the boot `--version` probe of a tool times out, the tool stays recorded as missing (`null`) until the process restarts.
- **Effect:** every job fails with `ENGINE_UNAVAILABLE` until someone restarts the process.
- **Fix:** re-probe a missing tool, at most once every 30 s. After `yt-dlp -U`, don't replace a known version with `null`.

### 7. Maintenance runs on every worker
- **Problem:** the artifact sweep and the storage measurement run in every worker process, including regional machines.
- **Effect:** regional machines sweep their own disks and overwrite the shared storage-usage figure, so the `STORAGE_MAX_GB` check works from wrong numbers.
- **Fix:** run maintenance only in download-role processes in the main region.

### 8. Downloads still fake their location
- **Problem:** download commands don't pass `--xff never`, so yt-dlp can fake the `X-Forwarded-For` header to get past geo-blocks. The plan rules this out.
- **Fix:** add `--xff never` before the `--` URL separator. The test for this is already in `test/features/eligibility/worker-recheck.test.ts`.

---

## Decisions made during the fixes

- **Queue names:** download queues are `media-jobs-<region>`. The regional extract queue had the same `:` bug, so its BullMQ name now replaces `:` with `-`.
- **Main region:** `REGION=default` (the default) is the main region, and any other value is a regional VM. **The main deployment must leave `REGION` unset.** Regional VMs don't run maintenance, so their artifacts aren't swept.
- **Bot challenge:** mapped to `SERVICE_UNAVAILABLE` (503), never cached, and retried by the worker.
- **Geo-block messages** are checked before "unavailable / not found", so "Video unavailable. Not available in your country" no longer becomes a 404.
- **Regional errors** are sent as `AppError:{json}`. Only a worker-reported `SOURCE_GEOBLOCKED` surfaces as a geo-block. Timeouts stay `SOURCE_TIMEOUT`, and any other failure becomes 502 `UPSTREAM_FAILED`.
- **After `yt-dlp -U`:** if the version can't be re-read, the old version is kept and a warning is logged.
- **Cached records** keep their old platform name until they expire (up to 6 h).
- **One test wasn't seen failing on its own:** the worker's "bot challenge is retryable" test passed as soon as the extraction mapping was fixed.

---

## Minor findings (deferred, not fixed)

1. **Sweep stalls on files outside the storage folder.** Rows the sweep refuses to touch can fill every batch, and a failed delete still clears the row, which leaves the file orphaned.
2. **Policy isn't loaded before requests are served.** Until the DB or snapshot loads at boot, requests use the code defaults, which ignore an active maintenance mode or a disabled platform.
3. **A stale refresh can roll back a newer publish.** No version check stops a refresh that started before version N+1 from applying version N.
4. **The shutdown force-exit timer starts late.** It is set only after the yt-dlp listener and policy-store shutdowns are awaited, so a hang there isn't covered.
5. **A tightened age limit misses cached results.** A cache hit doesn't re-check a lowered `ageLimitMax`, so the change can take up to 6 h to apply.

---

## Fixed during Phase 4

- **Flaky test suite (from Phase 3):**
  - Cause: `stop()` in the policy store didn't wait for refreshes already running. A snapshot write could then outlive the store and race the temp-dir cleanup (`ENOTEMPTY`/`ENOENT`).
  - Fix: `stop()` now drains in-flight refreshes, in `apps/api/src/features/restrictions/policy.store.ts`.
  - Test: "stop() waits for an in-flight refresh to finish its snapshot write" failed before the fix and passes after it. The full suite then passed 185/185 three times in a row.

---

## Points the reviewer left open (my rulings: they stand)

- **When storage usage is unknown, the `STORAGE_FULL` check lets downloads through.** The cap protects the disk, so it isn't a security control.
- **`/healthz` shows tool versions publicly.** The plan requires this.
- **`ENGINE_UNAVAILABLE` stays a permanent failure.** The re-probe in Important #6 fixes the stickiness instead.
- **`trust proxy` is still set to `1` (from before this work).** It's left for a later wiring task.
- **`.gitignore` now ignores `/docs`.** I didn't make this change, and I've left it alone. Note that it also hides this file and the plan from git.

---

## Repository issues for you to decide

1. **Commit `2a3f4e4`** (Task 4.1, `/healthz`) was made before the no-commit instruction. To undo it and keep its changes, run `git reset --soft HEAD~1`. I won't do this until you confirm.
2. **Stray untracked files** at the repo root: `prisma/` and `prisma.config.ts`. They aren't from this work and I haven't touched them.
3. **`.gitignore` ignores `/docs`** (see above).
4. **No ledger lines for Phases 2.3–3.x.** Their commits exist (`f22961e`, `185956c`), but this run didn't re-verify them.

---

## Configuration added in Phase 4

| Variable | Purpose |
|---|---|
| `YTDLP_AUTO_UPDATE` | Daily `yt-dlp -U` in every process. `false` removes the scheduled job. |
| `STORAGE_MAX_GB` | Storage cap. New jobs get a 503 `STORAGE_FULL` once usage measured by the workers goes over it. |
| `TRUSTED_PROXY_CIDRS` | Proxies allowed to set `CF-IPCountry`. An empty list means the header is ignored. |
