# @media/shared

Isomorphic code shared by the API and the web app. It is built with `tsc` to `dist/` and consumers import the compiled output, so run `npm run build -w @media/shared` (or `dev` for watch mode) after changes. The root `npm run dev` does this automatically.

## Modules

| File | Provides |
| --- | --- |
| `tiers.ts` | `GUEST` / `FREE` / `PRO` policies (max height, fps, limits). Single source of truth for access control |
| `media.ts` | Media and format types |
| `eligibility.ts` | Rules deciding whether a format is available to a tier |
| `stream-token.ts` | HMAC stream-grant signing and verification (shared `STREAM_SIGNING_SECRET`) |

The API enforces these rules; the frontend only uses them to render and to disable UI the server would reject anyway.

```ts
import { TIERS, type Tier } from '@media/shared';
```

Scripts: `build`, `dev`, `typecheck`.
