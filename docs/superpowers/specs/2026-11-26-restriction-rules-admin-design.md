# Admin-managed restriction rules: design

Date: 2026-11-26 · Status: draft, awaiting review

## 1. Goal

An admin can add, edit, disable and remove any kind of restriction from the admin UI. Today the
Restrictions page only edits a fixed set of settings (`global`, `tiers`, `platforms`). It cannot
create a new kind of restriction, edit one entry, or switch one off without losing it.

### Decisions already made

- **Generic rule list.** Admins create rules from a menu of types. Each rule has a name, parameters
  and an enabled toggle, and can be edited or deleted.
- **Existing settings become built-in rules.** They appear in the same list. Admins can edit or
  disable them but not delete them.
- **Hard floor stays in code, visible but locked.** DRM, private, members-only, login-required and
  18+ cannot be edited, disabled or deleted. They are listed as locked rows with a reason.
  Admins can add stricter rules on top.
- **Disabling a numeric built-in means "no cap".** (Confirmed in review.)

### Non-goals (v1)

- Country/region rules (the `regions` feature has not been checked for a usable per-request country).
- Rule priority numbers, ordering UI, or time-based scheduling. All rules only deny, so order only
  affects which message is shown.
- Allow-rules. Rules can never grant what the floor or another restriction refuses.
- A separate `Restriction` table. Rules live in the versioned policy document.

## 2. Approach

Store a `rules[]` list inside the existing versioned policy overrides (`PolicyVersion.overrides`).
Publish, rollback, audit logging, Redis broadcast (`policy:changed`), the 60 s poll, the
last-known-good snapshot and the preview dry-run all keep working unchanged.

Rejected: a separate `Restriction` table (loses version history, rollback and preview-before-publish,
and creates two sources of truth); toggles-only on the current schema (cannot create new kinds).

## 3. Data model

New key in `PolicyOverridesSchema`:

```ts
rules: Rule[]   // max 200; absent = []

Rule = {
  id: string            // stable, server-validated slug/uuid, unique within the list
  name: string          // 1..80
  type: RuleType
  enabled: boolean
  params: <per type>
  message?: string      // user-facing refusal text, max 300; default = stock copy for the type
  note?: string         // admin-only, max 500
}
```

Strict zod discriminated union on `type`. Arrays replace on merge, so each published version is a
full snapshot. A policy without `rules` loads as `[]`, so old versions and the snapshot file still
load, and rolling back to an old version drops newer rules.

`HARD_FLOOR` is untouched and the override schema still has no key for it. Rules produce refusals
only, and the floor runs first, so a rule cannot loosen it.

### Rule types (v1)

Common optional scope on limit-style rules: `tiers?: Tier[]`, `platforms?: PlatformId[]`.

| type | params | checked at |
|---|---|---|
| `block_host` | `hosts[]` (same hostname validation as `extraBlockedHosts`, max 500) | lookup |
| `block_platform` | `platform`, `actions` ⊆ {extract, download, playback} | lookup, download, playback |
| `block_url_pattern` | `pattern` (wildcard `*` only, no regex, max 200 chars) | lookup |
| `block_keyword` | `text` (1..100, case-insensitive substring), `fields` ⊆ {title, channel} | metadata |
| `max_duration` | `seconds` (int > 0), scope | metadata |
| `max_height` | `height` (int > 0), scope | format |
| `age_limit` | `max` (int 0..17) | metadata |
| `tier_only` | `minTier`, and `platforms[]` or `hosts[]` (at least one) | lookup, download, format |

### Built-in rules

Fixed ids, stored in the existing fields (no data migration):

| built-in id | backing field | "disabled" means |
|---|---|---|
| `builtin:maintenance` | `global.maintenanceMode` + message | off (no maintenance) |
| `builtin:extraction` | `global.extractionEnabled` | extraction stays on |
| `builtin:downloads` | `global.downloadsEnabled` | downloads stay on |
| `builtin:live-vod` | `global.allowLiveVod` | finished live streams allowed |
| `builtin:max-duration` | `global.maxDurationSec` | no cap |
| `builtin:age-limit` | `global.ageLimitMax` | cap falls back to the floor's 17 |
| `builtin:blocked-hosts` | `global.extraBlockedHosts` | list ignored |
| `builtin:platform:<id>` | `platforms.<id>` | platform fully allowed |
| `builtin:tier:<tier>` | `tiers.<tier>` | n/a, tier limits are edited, not disabled |

Schema change: `global.maxDurationSec` becomes nullable (`null` = no cap). Tier limits stay
edit-only; they are surfaced as built-in rows that link to the Tiers tab.

## 4. Enforcement

New pure module `restrictions/rules.ts`: `evaluateRules(policy, stage, ctx) → RuleHit | null`.
Pure so the live path and the preview share it (as `verdictFor` already does for fixed settings).
Matchers (patterns, keyword lowercasing) are compiled once per policy version and cached.

| stage | context | called from |
|---|---|---|
| lookup | URL, host, platform, tier | extraction entry, beside the blocked-host check |
| metadata | duration, age, title, channel, live, tier | after metadata fetch, beside eligibility/duration checks |
| format | tier, format, platform | `evaluateAccessIn` (locks the rendition, not the whole link) |
| download / playback | platform, host, tier | `assertPlatformAllowed` and download start |

Order: hard floor → existing built-in checks (unchanged) → custom rules in list order; first hit wins.

Refusal: new code `SOURCE_RULE_BLOCKED` (403) added to `IneligibleCode` and `INELIGIBLE_COPY` in
`@media/shared`. Message = `rule.message` or stock copy. Rule id/name never reach end users. Format
rules (`max_height`, `tier_only`) lock the rendition with the existing lock reasons.

Queued downloads must be re-checked at job start so a rule published mid-queue applies. The worker
has not been read yet; the plan must confirm this re-check exists or add it.

## 5. Admin API

Endpoints unchanged: `GET /`, `POST /` (publish), `POST /preview`, `POST /:version/activate`.

- `GET /` additionally returns `ruleTypes` (label, parameter field descriptors, stock copy) and the
  floor as rule-shaped data for the locked rows.
- Validation errors return 422 `POLICY_INVALID` with a path (e.g. `rules[3].params.seconds`).
- `Verdict` gains `rule: { id, name } | null`; locked-format counts include rule locks.
- Audit is unchanged (`policy.publish` records overrides + note).

## 6. Admin UI

Restrictions screen becomes a rule list:

1. **Locked**: floor rows, lock icon + one-line reason, no controls (replaces the Hard floor card).
2. **Built-in**: toggle + Edit (the old fields move into the edit panel), no Delete.
3. **Custom**: toggle, Edit, Delete (confirm).
4. **Add rule**: type picker, then a form generated from `ruleTypes`, plus name, optional user
   message, note.
5. Row summary line (e.g. "Blocks `*/shorts/*` for all tiers") and a **Test** button that opens the
   existing URL preview with that rule highlighted.

Draft: rules are edited as one `rules` value through `usePolicyDraft`; nothing is live until
publish. The review sheet shows rule-level diffs (added / edited / disabled / removed). Discard
drops the draft; rollback is the existing version history. Tiers and Sites keep their screens; their
settings appear as built-in rows linking there.

Web code must follow `apps/web/AGENTS.md` (read `node_modules/next/dist/docs/` before writing).

## 7. Testing

- API unit: each rule type in `evaluateRules`; schema/merge (strict, cap, `rules` absent, rollback);
  floor cannot be loosened by any rule; disabled rules skipped; built-in disable semantics; preview
  verdict names the rule.
- API integration: admin publish → enforce → rollback with rules.
- Playwright: add, edit, disable, delete, publish, test-URL flow; locked rows have no controls.

## 8. Open items for the plan

1. Confirm the worker re-checks policy at download start (see §4).
2. Custom rule ids are UUIDs generated client-side when the rule is added; the server only checks
   format and uniqueness. Built-in ids are the fixed `builtin:*` strings above.
3. Confirm the `block_keyword` metadata fields (`title`, `channel`) are available in the cached record.
