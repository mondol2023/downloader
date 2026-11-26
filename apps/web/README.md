# @media/web

Next.js (App Router, React 19) frontend for Media Engine: URL extraction UI, format picker, job tracking, in-app player, account/billing, admin console and CMS editor.

## Run

```bash
npm run dev -w @media/web     # http://localhost:3000
```

The API must be running (default `http://localhost:4000`). The browser never calls it directly: server-side requests go through a BFF that uses `API_INTERNAL_URL`, which is never exposed to the client.

| Script | Does |
| --- | --- |
| `dev` / `build` | Next dev server / production build |
| `lint` | ESLint |
| `e2e` | Playwright tests (`e2e/`, API mocked with `page.route`) |

First Playwright run: `npx playwright install`.

## Environment

`API_INTERNAL_URL`, `NEXT_PUBLIC_SITE_NAME`, `NEXT_PUBLIC_SITE_URL`, `STREAM_SIGNING_SECRET` (must equal the API's) and `REVALIDATE_SECRET` (must equal the API's). See [.env.example](../../.env.example).

## Layout

```
src/app/
  page.tsx            extract landing page
  login, register, pricing, account, jobs, m/[mediaId]   user flows and player
  (site)/             CMS-rendered pages (privacy, terms, dmca, p/...)
  (admin)/admin/      users, jobs, tiers, restrictions, takedowns, sites, audit, content
  api/stream          verifies signed stream grants
  api/revalidate      cache invalidation called by the API on CMS publish
  dev/editor          CMS editor sandbox
src/features/         auth, billing, extract, formats, history, jobs, player, admin, cms
e2e/                  Playwright specs
```

## Notes

- Tier rules shown in the UI come from `@media/shared` and are advisory; the server re-checks everything.
- CMS content is authored with TipTap and rendered through `@media/rich-text`, which sanitises it.
- Read [AGENTS.md](AGENTS.md) before changing Next.js code: this Next version has breaking differences from older releases.
