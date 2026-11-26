# Admin Error Log: Design

Date: 2026-11-26
Status: Approved by user (choices as written); proceeding to plan

## Goal

Give admins one page that shows every error that happened in the product: what the message was, when it happened, on which page, and what the user or system was doing. Errors are kept permanently so they can be fixed later and mined for future development.

## Decisions already made

- Approach A: one central `recordError()` pipeline that reuses the existing outbox and Google Sheets sink.
- Local "sheet file" is an append-only **CSV** at `storage/error-logs/errors.csv`. No new dependency.
- Postgres is the source of truth. Google Sheets is a best-effort mirror. CSV is the always-on local copy.

## Sources captured

| Source | Hook |
|---|---|
| `api` | `errorHandler` in `apps/api/src/middleware/error-handler.ts` (5xx and unexpected 4xx only; skip validation and 404 noise) |
| `worker` | failed-job handler in `queue/worker.ts`, `extraction.service.ts`, plus `unhandledRejection` / `uncaughtException` |
| `web-client` | `app/error.tsx`, `app/global-error.tsx`, and a client reporter for `window.onerror` and `unhandledrejection`, posting to `POST /api/v1/client-errors` |
| `web-server` | `instrumentation.ts` `onRequestError` |

Every hook is wrapped in try/catch. Logging must never change or break a response.

## Data model

New Prisma model `ErrorLog`:

- `id`, `occurredAt` (timestamptz, UTC; one row per occurrence so every error keeps its own exact date and time)
- `source` (api | web-server | web-client | worker), `severity`
- `message`, `stack` (DB and CSV only)
- `fingerprint` (hash of source + normalized message + top stack frame; used to group repeats in queries, with count and first/last seen computed from the rows)
- `page` (route, query string stripped), `method`, `status`
- `action` (what was happening, e.g. "extract URL", "save CMS page")
- `userId`, `requestId`, `context` (sanitized JSON)
- `resolved`, `resolvedBy`, `resolvedAt`
- Indexes: `occurredAt`, `fingerprint`, `source`, `resolved`. Resolving applies to every row sharing a fingerprint.

"What was happening": the API derives it from the route; the client passes an `action` label; key flows can tag themselves via a small `setErrorAction("...")` helper.

## recordError() flow

1. Redact and truncate the input (see Safety).
2. Compute fingerprint. Insert one DB row with `occurredAt = now`.
3. If the DB is down, write to the outbox as a new `error_log` kind (extend `OutboxKind` and `parse()` in `outbox.ts`); the existing drainer replays it idempotently.
4. Always append a CSV row to `storage/error-logs/errors.csv` (header row, daily rotation: `errors-YYYY-MM-DD.csv`; columns include `occurredAt` ISO-8601 UTC plus separate `date` and `time` columns).
5. Queue a Sheets row on a new `errors` tab through `sheets-sink.ts`, with a column allowlist and a trimmed stack.
6. An in-memory dedup window drops identical errors repeated within a few seconds, so an error storm cannot flood the DB, CSV or Sheet.

Sheets mirror stays off unless `SHEETS_SPREADSHEET_ID` is set (existing behaviour).

## Admin API (ADMIN only, same guards as audit)

- `GET /admin/errors`: filter by source, page, status, resolved, date range, text; paginated; grouped by fingerprint.
- `GET /admin/errors/:id`: detail including stack and context.
- `PATCH /admin/errors/:id`: mark resolved or unresolved.
- `GET /admin/errors/export.csv`: download the filtered set.

## Admin UI

- New page `/admin/errors` under `apps/web/src/app/(admin)/admin/errors`, feature code in `apps/web/src/features/admin/errors`, modelled on the audit page.
- Table columns: date and time, source, page, action, message, count (per fingerprint in the filtered range), status. Rows are sorted newest first and grouped under date headings.
- Date and time filter (from/to) with quick presets (today, 24h, 7 days).
- Filters, detail drawer (stack, context, request id), resolve toggle, Export CSV button.
- New sidebar entry.

## Safety and privacy

- Redact tokens, cookies, auth headers, emails, passwords and query strings from `message`, `page` and `context`.
- Never store raw IPs. No request bodies.
- Client endpoint: rate-limited, payload capped at about 8 KB, schema-validated.
- Stack traces stay in DB and CSV; the Sheet gets a short redacted version.
- CSV cells are escaped against formula injection (leading `=`, `+`, `-`, `@`).

## Testing

- Vitest unit: redaction, fingerprinting, CSV writer (escaping and rotation), dedup window.
- Integration: error-handler hook records 5xx and skips 404 and validation; admin endpoints and role guard; outbox fallback when DB is down.
- Playwright: trigger a client error, see it on `/admin/errors`.

## Out of scope

- Alerting (email, Slack), retention or purge jobs, third-party tools such as Sentry. These can be added later on top of the same table.

## Open points for review

- Daily CSV rotation (assumed yes).
- Whether the Sheet should include any stack text (assumed short redacted version).
