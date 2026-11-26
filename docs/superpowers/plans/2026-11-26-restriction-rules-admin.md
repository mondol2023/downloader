# Admin-Managed Restriction Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin add, edit, disable and delete restrictions of many kinds from the Restrictions page, on top of a locked hard floor.

**Architecture:** A `rules[]` list and a `disabledBuiltins[]` list live inside the existing versioned policy overrides, so publish, rollback, audit, Redis broadcast, snapshot and preview keep working. One pure engine (`restrictions/rules.ts`) evaluates rules at four stages; the same engine feeds the live guards and the admin preview. The Restrictions screen becomes a locked / built-in / custom rule list backed by the existing draft store.

**Tech Stack:** TypeScript, Express, zod, vitest (API); Next.js (breaking-change version), React Query, Playwright (web); `@media/shared` for shared types.

**Spec:** `docs/superpowers/specs/2026-11-26-restriction-rules-admin-design.md` (amended in the same commit as this plan; where this plan differs from the earlier text, the plan states why).

## Global Constraints

- Rules are deny-only; the hard floor (`HARD_FLOOR`) is untouched and still has no override key. A rule or a disabled built-in can never loosen it.
- Limits: at most 200 rules; `name` 1..80; `message` ≤ 300; `note` ≤ 500; URL pattern ≤ 200 chars and ≤ 5 `*`; keyword text 1..100; `block_host.hosts` ≤ 500 (same hostname validation as `extraBlockedHosts`); `age_limit.max` int 0..17; scope arrays, when present, have at least 1 entry.
- Rule types (exact ids): `block_host`, `block_platform`, `block_url_pattern`, `block_keyword`, `max_duration`, `max_height`, `age_limit`, `tier_only`. URL patterns are wildcard (`*`) only, never regex.
- One new refusal code `SOURCE_RULE_BLOCKED` (HTTP 403). Rule ids and names never reach end users; only admins see them (preview, audit).
- Built-in toggles that can be disabled without losing their value: `maxDuration`, `ageLimit`, `blockedHosts` (stored in `disabledBuiltins`).
- Validation error paths are dotted, e.g. `rules.3.params.seconds`.
- Web code: read the relevant guide under `apps/web/node_modules/next/dist/docs/` (or the hoisted `node_modules/next/dist/docs/`) before writing any web file, per `apps/web/AGENTS.md`.
- Commits: stage only the files a task names. The working tree has unrelated uncommitted user changes (`apps/api/prisma/seed.ts`, several `apps/web/e2e/*` specs, `DownloadBar.tsx`, `dmca/page.tsx`, untracked `legal-pages.ts`, etc.); never `git add -A`, never touch those files. End commit messages with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Commands: API tests `npm test -w @media/api -- <path>`; typecheck `npm run typecheck`; shared must be rebuilt after changes (`npm run build -w @media/shared`) before API/web see them.

## Review Focus

1. A URL pattern with many `*` against a 2048-char URL must not hang (ReDoS); patterns match case-insensitively on `host + path + query` (Task 3).
2. Metadata with `null` duration, `null` uploader, empty title, or a platform outside the 14 known ids (yt-dlp long tail) must not crash or wrongly block (Task 3, Task 5).
3. Invalid rule lists are refused whole with a path: duplicate ids, a 201st rule, empty name, empty scope array, unknown type, unknown key (Task 2).
4. An old snapshot or older policy version with no `rules` / `disabledBuiltins` keys loads as empty lists, and rolling back drops newer rules (Task 2).
5. Disabling the `ageLimit` built-in falls back to the floor's 17, never to "no cap"; disabling `blockedHosts` never unblocks DRM hosts (Task 4).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/rules.ts` (new) | `Rule` types, `RULE_TYPES`, `BUILTIN_TOGGLES`, `RULE_CATALOGUE` (labels, field descriptors) used by API tests and the web form |
| `packages/shared/src/eligibility.ts` | add `SOURCE_RULE_BLOCKED` code + copy |
| `apps/api/src/features/restrictions/rules.schema.ts` (new) | zod schema for `rules` and `disabledBuiltins` |
| `apps/api/src/features/restrictions/policy.schema.ts` | `SoftPolicy` gains `rules`, `disabledBuiltins`; overrides schema uses `rules.schema.ts` |
| `apps/api/src/features/restrictions/restrictions.config.ts` | defaults `rules: []`, `disabledBuiltins: []` |
| `apps/api/src/features/restrictions/builtins.ts` (new) | `maxDurationOf`, `ageCapOf`, `extraBlockedHostsOf`: effective built-in values honoring `disabledBuiltins` |
| `apps/api/src/features/restrictions/rules.ts` (new) | pure `evaluateRules`, `ruleHeightCap`, `globToRegExp`, `defaultRuleMessage` |
| `apps/api/src/features/restrictions/enforce.ts` | `assertRulesAllowSource/Media/Action`; `tierPolicyIn` applies height cap; duration guard uses `builtins.ts` |
| `apps/api/src/features/eligibility/{blocked-hosts,eligibility}.ts` | use `builtins.ts` |
| `apps/api/src/services/extraction.service.ts`, `routes/{jobs,media}.routes.ts`, `queue/worker.ts` | call the new guards; `extractMedia` takes `tier` |
| `apps/api/src/features/admin/policy.preview.ts`, `policy.admin.ts` | rules in dry-run verdicts |
| `apps/web/src/features/admin/policy/{types,draft}.ts`, `ReviewSheet.tsx`, `PolicyScreen.tsx`, `RestrictionsEditor.tsx` | draft + review + screen wiring |
| `apps/web/src/features/admin/policy/rules/*` (new) | `ruleModel.ts`, `RuleList.tsx`, `LockedRules.tsx`, `BuiltinRows.tsx`, `RuleForm.tsx` |
| `apps/web/src/features/extract/{copy.ts,components/ExtractDeck.tsx}` | copy for the new code; show a rule's own message |

---

### Task 1: Shared types, catalogue and refusal code

**Files:**
- Create: `packages/shared/src/rules.ts`
- Modify: `packages/shared/src/eligibility.ts`, `packages/shared/src/index.ts` (export `./rules.js`), `apps/web/src/features/extract/copy.ts`, `apps/web/src/features/extract/components/ExtractDeck.tsx`
- Test: `apps/web/e2e/rule-refusal.spec.ts` (new; do not edit the user's modified `extract.spec.ts`)

**Interfaces:**
- Produces (`@media/shared`):
  - `RULE_TYPES` (const tuple of the 8 ids), `type RuleType`
  - `BUILTIN_TOGGLES = ['maxDuration','ageLimit','blockedHosts'] as const`, `type BuiltinToggleId`
  - `type Rule` = discriminated union on `type`, each member `{ id: string; name: string; type; enabled: boolean; params: ...; message?: string; note?: string }` with params exactly: `block_host {hosts: string[]}`; `block_platform {platform: string; actions: Array<'extract'|'download'|'playback'>}`; `block_url_pattern {pattern: string}`; `block_keyword {text: string; fields: Array<'title'|'channel'>}`; `max_duration {seconds: number; tiers?: Tier[]; platforms?: string[]}`; `max_height {height: number; tiers?: Tier[]; platforms?: string[]}`; `age_limit {max: number}`; `tier_only {minTier: Tier; platforms?: string[]; hosts?: string[]}`
  - `RULE_CATALOGUE: Record<RuleType, { label: string; description: string; fields: RuleField[] }>` where `RuleField = { key: string; label: string; kind: 'hosts'|'platform'|'platforms'|'tiers'|'actions'|'keywordFields'|'pattern'|'text'|'int'|'tier'; hint?: string; optional?: boolean }`
  - `INELIGIBLE_CODES` gains `'SOURCE_RULE_BLOCKED'`; `INELIGIBLE_COPY.SOURCE_RULE_BLOCKED = { title: "This link isn't available", body: "This content is restricted by this service's rules." }`
- Consumes: `Tier` from `./tiers.js`.

- [ ] **Step 1: Write the failing e2e test** in `apps/web/e2e/rule-refusal.spec.ts`: mock `POST /media/extract` (see `helpers.ts` `mock`/`fail`) to return `fail(403, 'SOURCE_RULE_BLOCKED', 'Shorts are not supported here.')`; paste a URL on `/`; assert `getByTestId('refusal')` has `data-code="SOURCE_RULE_BLOCKED"`, contains the title `INELIGIBLE_COPY.SOURCE_RULE_BLOCKED.title`, contains the body text `Shorts are not supported here.`, and does not contain the stock body.
- [ ] **Step 2: Run it, expect FAIL** (`npm run e2e -w @media/web -- e2e/rule-refusal.spec.ts`; the code is unknown to the client, so no `refusal` testid).
- [ ] **Step 3: Implement** `rules.ts` and the code/copy; rebuild shared; add `NEXT_STEP.SOURCE_RULE_BLOCKED = "Try a different link."` in `copy.ts` (the `Record<IneligibleCode,…>` forces it); in `ExtractDeck.tsx:158` render `error.message` as the body when `refusal === 'SOURCE_RULE_BLOCKED'` and `error instanceof ApiError`, otherwise `refusalCopy(refusal).body`.
- [ ] **Step 4: Run** the e2e test (PASS) and `npm run typecheck` (clean).
- [ ] **Step 5: Commit** `packages/shared/src/rules.ts packages/shared/src/eligibility.ts packages/shared/src/index.ts apps/web/src/features/extract apps/web/e2e/rule-refusal.spec.ts` — `feat(shared): rule types, catalogue and SOURCE_RULE_BLOCKED`.

---

### Task 2: Policy schema, defaults and merge

**Files:**
- Create: `apps/api/src/features/restrictions/rules.schema.ts`
- Modify: `policy.schema.ts`, `restrictions.config.ts`, `restrictions/index.ts` (export `RulesSchema`)
- Test: `apps/api/test/features/restrictions/rules.schema.test.ts` (new); a case added to `store.test.ts`

**Interfaces:**
- Produces: `rulesSchema` and `disabledBuiltinsSchema` (zod) and `RULES_MAX = 200`; `SoftPolicy.rules: Rule[]`; `SoftPolicy.disabledBuiltins: BuiltinToggleId[]`; `DEFAULT_POLICY.rules = []`, `.disabledBuiltins = []`. `mergePolicy` output carries both keys. `toPublicPolicy` is unchanged (rules must not leak to anonymous clients).
- Consumes: `Rule`, `BuiltinToggleId` from `@media/shared`; existing `hostname` validator and `PLATFORM_IDS` in `policy.schema.ts` (export `hostname` or move it to `rules.schema.ts`; avoid an import cycle).

- [ ] **Step 1: Write failing tests** (`rules.schema.test.ts`, all through `mergePolicy(DEFAULT_POLICY, overrides, 1)` and `catchPolicyError` as in `merge.test.ts`):
  - a valid rule of each of the 8 types merges and appears in `p.rules` unchanged;
  - `{}` overrides → `p.rules` equals `[]` and `p.disabledBuiltins` equals `[]`;
  - 201 rules → 422 `POLICY_INVALID`; duplicate ids → 422 with a detail path starting `rules`; empty `name` → path `rules.0.name`; `max_duration` with `seconds: 0` → path `rules.0.params.seconds`; `tiers: []` → path `rules.0.params.tiers`; unknown type → 422; unknown key on a rule → 422 `unknown key`; `age_limit.max: 18` → 422; `block_url_pattern` with 6 `*` or 201 chars → 422; `tier_only` with neither `platforms` nor `hosts` → 422; `disabledBuiltins: ['bogus']` → 422;
  - rules replace rather than merge (publishing `[]` over a policy that had rules yields `[]`).
  - `store.test.ts`: a snapshot/stored overrides object without the new keys boots to empty lists (read `policy.store.ts` snapshot loading first; if the snapshot stores an `EffectivePolicy` directly, default the missing keys on read).
- [ ] **Step 2: Run, expect FAIL** (`npm test -w @media/api -- test/features/restrictions`).
- [ ] **Step 3: Implement.** `rulesSchema`: `z.array(ruleUnion).max(RULES_MAX)` with `.superRefine` for unique ids (issue path `[index,'id']`); `ruleUnion` is `z.discriminatedUnion('type', [...])`, each member `.strict()`, params `.strict()`; URL pattern matches `/^[^\s]{1,200}$/` plus a `*`-count refine; scope arrays `.min(1)`. Add the two keys to `PolicyOverridesSchema` and `SoftPolicy`. Type check the schema against `Rule` with `satisfies z.ZodType<Rule>`-style assertion.
- [ ] **Step 4: Run** the restrictions tests (PASS) and typecheck.
- [ ] **Step 5: Commit** — `feat(api): rules and disabledBuiltins in the policy schema`.

---

### Task 3: Rule engine

**Files:**
- Create: `apps/api/src/features/restrictions/rules.ts`
- Test: `apps/api/test/features/restrictions/rules.test.ts` (new)

**Interfaces:**
- Produces:
  - `type RuleContext` =
    `{stage:'source'; tier: Tier; url: string; host: string; platform: string}` |
    `{stage:'metadata'; tier: Tier; platform: string; durationSeconds: number|null; ageLimit: number; title: string; uploader: string|null}` |
    `{stage:'action'; tier: Tier; action: 'download'|'playback'; host: string; platform: string}`
  - `interface RuleHit { rule: Rule; message: string }`
  - `evaluateRules(policy: Pick<EffectivePolicy,'rules'>, ctx: RuleContext): RuleHit | null` — first enabled matching rule in list order
  - `ruleHeightCap(policy: Pick<EffectivePolicy,'rules'>, tier: Tier, platform?: string): number` — smallest `max_height.height` among enabled matching rules, `Infinity` if none
  - `defaultRuleMessage(rule: Rule): string`; `globToRegExp(pattern: string): RegExp`
- Consumes: `Rule`, `Tier`, `INELIGIBLE_COPY` from shared; `isBlockedHost`-style label-boundary host matching (write a local `hostMatches(host, base)`; do not import eligibility to keep this pure).

Matching rules (one line each): `block_host` label-boundary match of any host; `block_platform` hits at `source` for action `extract`, at `action` for `download`/`playback`; `block_url_pattern` compares `globToRegExp(pattern)` (anchored, case-insensitive) with `host + pathname + search` derived from `ctx.url`; `block_keyword` case-insensitive substring over `title` and/or `uploader` per `fields`; `max_duration` hits at `metadata` when `durationSeconds != null && > seconds` and tier/platform scope matches; `age_limit` hits at `metadata` when `ageLimit > max`; `tier_only` hits at `source` and `action` when tier rank (index in `TIERS`) < rank of `minTier` and platform ∈ `platforms` or host matches `hosts`; `max_height` only feeds `ruleHeightCap`. Empty/undefined scope = applies to all. Disabled rules are skipped. Compiled matchers are cached in a `WeakMap<Rule[], …>` keyed by `policy.rules`.

Default messages: `max_duration` → `` `Longer than the ${Math.floor(seconds/60)}-minute limit.` ``; `tier_only` → `` `This is available on the ${minTier} plan and above.` ``; others → `INELIGIBLE_COPY.SOURCE_RULE_BLOCKED.body`. A rule's own `message` wins.

- [ ] **Step 1: Write failing tests** (`rules.test.ts`): one hit and one miss per rule type per stage; list order decides the first hit; disabled rule skipped; own `message` returned, else the default above; `globToRegExp('*/shorts/*')` matches `youtube.com/shorts/abc` and not `youtube.com/watch?v=1`; matching is case-insensitive; **ReDoS**: pattern `*a*a*a*a*` against a 2048-char `a…ab` URL returns in under 50 ms; `durationSeconds: null` never hits `max_duration`; `uploader: null` with `fields: ['channel']` is a miss, not a throw; unknown platform string (`'somesite'`) with a platform-scoped rule is a miss; `tier_only` GUEST < FREE < PRO ordering with `minTier: 'FREE'`; `ruleHeightCap` returns the minimum of matching rules and `Infinity` with none, honoring tier and platform scope.
- [ ] **Step 2: Run, expect FAIL** (module not found).
- [ ] **Step 3: Implement** `rules.ts` as specified. `globToRegExp`: escape every regex metacharacter, then replace `\*` with `.*`; anchor with `^…$`, flag `i`.
- [ ] **Step 4: Run** `npm test -w @media/api -- test/features/restrictions/rules.test.ts` (PASS).
- [ ] **Step 5: Commit** — `feat(api): pure restriction rule engine`.

---

### Task 4: Built-in toggles and the floor

**Files:**
- Create: `apps/api/src/features/restrictions/builtins.ts`
- Modify: `enforce.ts` (`assertDurationAllowed`), `features/eligibility/blocked-hosts.ts`, `features/eligibility/eligibility.ts`
- Test: `apps/api/test/features/restrictions/builtins.test.ts` (new)

**Interfaces:**
- Produces: `type BuiltinView = Pick<EffectivePolicy,'global'> & { disabledBuiltins?: BuiltinToggleId[] }` (optional so existing callers and tests that pass partial policies keep compiling); `maxDurationOf(p: BuiltinView): number | null` (null when `maxDuration` disabled); `ageCapOf(p?: BuiltinView): number` (`min(ageLimitMax, 17)`, or 17 when `ageLimit` disabled); `extraBlockedHostsOf(p?: BuiltinView): string[]` (`[]` when `blockedHosts` disabled).
- Consumes: `HARD_FLOOR`.

- [ ] **Step 1: Write failing tests:** each helper with the toggle off and on; **floor:** with `ageLimit` disabled `evaluateEligibility({ageLimit: 18, …}, policy)` still returns `SOURCE_AGE_RESTRICTED`; with `blockedHosts` disabled `isBlockedHost('netflix.com', policy)` is still true while an extra host (`example.com`) is no longer blocked; `assertDurationAllowed(10 * 3600)` does not throw when `maxDuration` is disabled (set the current policy with `setCurrentPolicy`, as `enforce.test.ts` does) and throws `SOURCE_TOO_LONG` when enabled.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the helpers and switch the three call sites to them (`isBlockedHost` uses `extraBlockedHostsOf`; `evaluateEligibility` uses `ageCapOf`; `assertDurationAllowed` uses `maxDurationOf`, skipping when null).
- [ ] **Step 4: Run** all of `test/features/restrictions` and `test/features/eligibility` (PASS, existing tests untouched).
- [ ] **Step 5: Commit** — `feat(api): disable-able built-in limits that keep their values`.

---

### Task 5: Enforcement wiring

**Files:**
- Modify: `enforce.ts`, `restrictions/index.ts`, `services/extraction.service.ts`, `routes/jobs.routes.ts`, `routes/media.routes.ts`, `queue/worker.ts`
- Test: `apps/api/test/features/restrictions/rules.enforce.test.ts` (new); one case added to `apps/api/test/features/eligibility/worker-recheck.test.ts` following its existing pattern

**Interfaces:**
- Produces (in `enforce.ts`, all read `getPolicy()` and throw `new AppError(403, 'SOURCE_RULE_BLOCKED', hit.message)`):
  - `assertRulesAllowSource(source: { canonical: string; host: string; platform: string }, tier: Tier): void`
  - `assertRulesAllowMedia(media: Pick<MediaMetadata,'platform'|'durationSeconds'|'ageLimit'|'title'|'uploader'>, tier: Tier): void`
  - `assertRulesAllowAction(input: { action: 'download'|'playback'; platform: string; canonicalUrl: string }, tier: Tier): void` (host derived with `new URL(canonicalUrl).hostname`)
  - `tierPolicyIn` returns `maxHeight = min(tier cap, platform cap, ruleHeightCap(policy, tier, platform))`, which flows into `evaluateAccessIn`, `gateRecord`, `assertFormatAllowed`, the worker's `tierPolicyFor` and the preview with no further changes.
  - `extractMedia(rawUrl, options: { signal?; force?; userRegion?; tier: Tier })` — `tier` is required so a missed caller fails to compile.
- Call sites: source stage in `resolveRecord` right after `assertNotTakenDown` (outside the cached-refusal path, so rule changes apply immediately and are never cached as refusals); metadata stage in `extractMedia` right after `assertDurationAllowed`; action stage in `jobs.routes.ts` after `assertPlatformAllowed(platform, 'download')`, in `media.routes.ts` after `assertPlatformAllowed(…, 'playback')`, and in the worker's `recheckPolicy` (add a `tier` parameter; its caller has `payload.tier`) so a rule published while a job is queued still applies. Pass `tier` at the four `extractMedia` calls (`jobs.routes.ts:73`, `media.routes.ts:47` and `:107`, `worker.ts:368`).

- [ ] **Step 1: Write failing tests** (`rules.enforce.test.ts`, policy set via `setCurrentPolicy(mergePolicy(DEFAULT_POLICY, {rules:[…]}, 1))`): each assert throws code `SOURCE_RULE_BLOCKED` with status 403 and the rule's message for a matching rule and passes for a non-matching or disabled one; `tierPolicyFor('FREE','youtube').maxHeight` is lowered by an enabled `max_height` rule scoped to FREE+youtube and unchanged for PRO and for `tiktok`; the unknown-platform case (`'somesite'`) passes; worker-recheck case: a queued `download` job for a platform blocked on `download` fails with `UnrecoverableJobError` text containing `SOURCE_RULE_BLOCKED` and releases the reservation, like the existing platform-disabled case.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the guards and wire the call sites; export the guards from `index.ts`.
- [ ] **Step 4: Run** `npm test -w @media/api` (full suite PASS) and `npm run typecheck` (the required `tier` surfaces any missed caller, including tests that call `extractMedia`; fix those by passing `'GUEST'`).
- [ ] **Step 5: Commit** — `feat(api): enforce restriction rules at lookup, metadata, download and playback`.

---

### Task 6: Preview and admin route

**Files:**
- Modify: `features/admin/policy.preview.ts`, `features/admin/policy.admin.ts`
- Test: `apps/api/test/features/admin/policy.admin.test.ts` (extend), plus pure `verdictFor` cases in a new `apps/api/test/features/admin/policy.preview.test.ts`

**Interfaces:**
- Produces: `PreviewSource` gains `url: string` (canonical); `PreviewMedia` gains `title: string; uploader: string | null`; `Verdict` gains `rule: { id: string; name: string } | null` and `blockedActions: Array<'download'|'playback'>`.
- Consumes: `evaluateRules`, `maxDurationOf`, `ageCapOf` (preview must use the same helpers as live code).

Order inside `verdictFor`: existing extraction switch → blocked host (uses `extraBlockedHostsOf` via `isBlockedHost`) → platform switch → `evaluateRules` source stage → takedown → (no media → allowed) → eligibility → built-in duration (skipped when `maxDuration` disabled) → metadata-stage rules → per-format counts (rule height caps arrive via `evaluateAccessIn`) → `blockedActions` from action-stage hits for `download` and `playback`. A rule refusal returns `refusal.code = 'SOURCE_RULE_BLOCKED'`, `refusal.message = hit.message` and `rule = { id, name }`.

- [ ] **Step 1: Write failing tests:** draft with a `block_url_pattern` → draft verdict refused with `rule.name`, active verdict still allowed; `max_height` rule lowers `formats.allowed`; `block_platform` with `actions: ['download']` → `allowed: true`, `blockedActions: ['download']`; a disabled `maxDuration` built-in lets a 10-hour cached record through; route test: `POST /preview` with `overrides.rules` returns the rule in `draft`; `POST /` with a bad rule returns 422 `POLICY_INVALID` whose `details[0].path` is `rules.0.params.seconds`; publish → `GET /` `active.rules` round-trips; rollback to a version without rules empties `active.rules`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**; pass `url: source.canonical`, `title`, `uploader` from the cached record in `policy.admin.ts`.
- [ ] **Step 4: Run** `npm test -w @media/api -- test/features/admin` (PASS) and typecheck.
- [ ] **Step 5: Commit** — `feat(api): rules in admin preview verdicts`.

---

### Task 7: Web data layer

**Files:**
- Create: `apps/web/src/features/admin/policy/rules/ruleModel.ts`
- Modify: `types.ts`, `draft.ts`, `ReviewSheet.tsx`, and the `base` fixture in `apps/web/e2e/admin-policy.spec.ts` (add `rules: [], disabledBuiltins: []`)
- Test: none of its own; the diff and verdict rendering are asserted by `admin-rules.spec.ts` in Task 8. This task is verified by typecheck and the existing `admin-policy.spec.ts`.

**Interfaces:**
- Produces (`ruleModel.ts`): `newRule(type: RuleType): Rule` (UUID via `crypto.randomUUID()`, `enabled: true`, empty `name`, minimal valid default params per type); `describeRule(rule: Rule): string` (summary line, e.g. `Blocks */shorts/* for all tiers`); `diffRules(from: Rule[], to: Rule[], fromOff: string[], toOff: string[]): string[]` returning lines `Added: <name>`, `Removed: <name>`, `Edited: <name>`, `Disabled: <name>`, `Enabled: <name>`, `Built-in disabled: <id>`, `Built-in enabled: <id>`; `ruleErrors(errors: Record<string,string>, index: number): Record<string,string>` mapping `rules.<index>.<rest>` keys to `<rest>`.
- `types.ts`: `SoftPolicy` gains `rules: Rule[]` and `disabledBuiltins: BuiltinToggleId[]`; `Verdict` gains `rule` and `blockedActions` (same shapes as Task 6).
- `draft.ts`: `editable()` includes `rules` and `disabledBuiltins`, so `toOverrides` omits them while they equal the defaults (`[]`). Each list is edited as a single path (`rules`, `disabledBuiltins`).
- `ReviewSheet.tsx`: for change rows with path `rules` or `disabledBuiltins`, render the `diffRules` lines instead of `formatValue`; `VerdictCard` also shows `Rule: <name>` when `v.rule` is set and `Blocked: download, playback` when `blockedActions` is non-empty.

- [ ] **Step 1: Read** the Next docs guide named in Global Constraints (client components, forms).
- [ ] **Step 2: Implement** the model file, the type and draft changes, and the ReviewSheet additions; update the e2e fixture.
- [ ] **Step 3: Run** `npm run typecheck` and `npm run e2e -w @media/web -- e2e/admin-policy.spec.ts` (still PASS).
- [ ] **Step 4: Commit** — `feat(web): rule model, draft and review-diff support`.

---

### Task 8: Restrictions screen

**Files:**
- Create: `rules/RuleList.tsx`, `rules/LockedRules.tsx`, `rules/BuiltinRows.tsx`, `rules/RuleForm.tsx` (all under `apps/web/src/features/admin/policy/`)
- Modify: `RestrictionsEditor.tsx`, `PolicyScreen.tsx` (prop `showFloor?: boolean`, default `true`; Sites and Tiers keep the existing `HardFloor` card and its `hard-floor` testid)
- Test: `apps/web/e2e/admin-rules.spec.ts`

**Interfaces:**
- `RestrictionsEditor` renders `<PolicyScreen title="Restrictions" showFloor={false}>` containing, top to bottom: `LockedRules` (`data-testid="locked-rule"` per row, built from `data.hardFloor` and `INELIGIBLE_COPY`; no switches or buttons); `BuiltinRows` (one `data-testid="builtin-<id>"` row each for maintenance, extraction, downloads, live VOD, max duration, age limit, extra blocked hosts, each with a switch labelled `Enabled` and an `Edit` button opening the old field in a `Sheet`; plus two link rows to `/admin/sites` and `/admin/tiers`); `RuleList` (`data-testid="rule-row-<id>"` per custom rule with `Enabled` switch, `Edit`, `Delete` → inline `Confirm delete`; an `Add rule` button opens a type picker, then `RuleForm`).
- Built-in toggles map to existing fields: maintenance ↔ `global.maintenanceMode` (message field in Edit); extraction ↔ inverted `global.extractionEnabled`; downloads ↔ inverted `global.downloadsEnabled`; live VOD ↔ inverted `global.allowLiveVod`; max duration, age limit, blocked hosts ↔ membership in `disabledBuiltins` (switch off = id present). Edit panels reuse `NumberField`, `TextField`, `HostChips`.
- `RuleForm` is generated from `RULE_CATALOGUE[type].fields` by `kind`, plus `name`, `message` and `note`; `Save rule` writes the whole `rules` array through `set('rules', next)`; field errors come from `ruleErrors(errors, index)` and render with `data-testid="field-error"`. Rows show a `Has errors` badge when any `rules.<index>.` error exists.

- [ ] **Step 1: Read** the Next docs guide (same as Task 7) if not already read in this session.
- [ ] **Step 2: Write failing e2e tests** in `admin-rules.spec.ts`, reusing the stub-server/`policyStore` pattern from `admin-policy.spec.ts` (copy the helper locally; the store keeps `rules` and `disabledBuiltins` and returns them in `active`):
  1. `locked rows have no controls`: `/admin/restrictions` shows locked rows for Private, Members-only, Login required, DRM and `Age 18+`, and `getByTestId('locked-rule').getByRole('switch')` has count 0.
  2. `add a URL-pattern rule`: Add rule → `Block URL pattern` → name `No shorts`, pattern `*/shorts/*` → Save → bar says `1 unpublished change` → Review → diff row contains `Added: No shorts` → note → Publish → the published body's `overrides.rules[0]` equals `{ id: <uuid>, name: 'No shorts', type: 'block_url_pattern', enabled: true, params: { pattern: '*/shorts/*' } }`.
  3. `edit, disable, delete`: with a seeded rule, edit its name (diff shows `Edited:`), switch it off (`Disabled:`), delete it with `Confirm delete` (`Removed:`).
  4. `disable a built-in keeps its value`: switch off the max-duration row → published `overrides` equals `{ disabledBuiltins: ['maxDuration'] }` and does not contain `global`.
  5. `a 422 lands on the rule field`: mock `POST /admin/policy` to `fail(422, 'POLICY_INVALID', …, { details: [{ path: 'rules.0.params.seconds', message: 'Number must be greater than 0' }] })` with a seeded `max_duration` rule; after Publish, opening that rule shows the message in `field-error` and its row shows `Has errors`.
  6. `the test panel names the rule`: mock `/admin/policy/preview` to return a draft verdict with `rule: { id, name: 'No shorts' }`; Review → Test → the Draft card contains `No shorts`.
- [ ] **Step 3: Run, expect FAIL** (`npm run e2e -w @media/web -- e2e/admin-rules.spec.ts`).
- [ ] **Step 4: Implement** the components and the `PolicyScreen` prop; use existing `Card`, `Badge`, `Button`, `Sheet` and the `fields.tsx` styling; keep touch targets ≥ 44 px like the existing fields.
- [ ] **Step 5: Run** `admin-rules.spec.ts`, `admin-policy.spec.ts`, then `npm run typecheck` and `npm run lint -w @media/web` (all PASS/clean).
- [ ] **Step 6: Commit** — `feat(web): rule-list Restrictions screen`.

---

### Task 9: Whole-branch verification

**Files:** none changed unless a check fails.

- [ ] **Step 1:** `npm run build -w @media/shared`, then `npm run typecheck` and `npm run lint` at the repo root: clean.
- [ ] **Step 2:** `npm test -w @media/api`: full suite passes.
- [ ] **Step 3:** `npm run e2e -w @media/web`: passes (the tests that need a stub API skip when a real API owns the port, as before). If any e2e spec the user already had modified now fails for reasons unrelated to rules, report it rather than editing it.
- [ ] **Step 4:** Manual run with `npm run dev`: sign in as admin, add a `*/shorts/*` rule, publish, paste a matching URL as a guest and confirm the refusal shows the rule's message; roll back from History and confirm the same link works. Report what was and was not exercised.
- [ ] **Step 5:** Commit any fixes; do not push or open a PR unless asked.
