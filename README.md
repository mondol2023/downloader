# Media engine

## Optional: Google Sheets ledger mirror

The API and worker can keep a read-only copy of the download log and audit trail in a Google Sheet. Postgres (plus the on-disk outbox) stays the source of truth; the sheet is a convenience view. Rows are flushed every 30 s, in batches of up to 500. `ip` and `userAgent` are never sent, and `guestKey` is replaced by a short sha256 prefix.

The feature is **off** unless both `SHEETS_SPREADSHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_FILE` are set.

1. In Google Cloud, create a service account and enable the **Google Sheets API** for the project. Create a JSON key for the account.
2. Create a spreadsheet with two tabs named exactly `download_log` and `audit_event`, then share it with the service account's email address as **Editor**. The header row is written automatically the first time a tab is empty.
3. Store the key JSON **outside the repo** (never commit it) and point `GOOGLE_SERVICE_ACCOUNT_FILE` at it. Set `SHEETS_SPREADSHEET_ID` to the id in the sheet's URL (`/spreadsheets/d/<id>/edit`).

If the Sheets API returns 429 the mirror backs off (1 s, 2 s, 4 s, 8 s; 5 tries) and then retries the rows on the next flush. Use Sheets for tabular rows only; a Google Doc is the wrong tool for data.
