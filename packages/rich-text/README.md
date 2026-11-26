# @media/rich-text

TipTap extensions, HTML renderer and allowlist sanitiser for CMS content. The editor, the server renderer and the API (on save) all use this package, so stored content is always sanitised.

## Exports

| Export | Purpose |
| --- | --- |
| `extensions` | TipTap extension set, including `FontSize`, `LineHeight`, `Indent` (max `MAX_INDENT`), `CmsImage` (widths in `IMAGE_WIDTHS`) and `Vimeo` |
| `renderHtml` | Render TipTap `JSONContent` to sanitised HTML |
| `sanitize` | Strip everything outside `ALLOWED_TAGS` / `ALLOWED_STYLES` |
| `JSONContent` | Re-exported TipTap document type |

```ts
import { renderHtml } from '@media/rich-text';
```

## Scripts

`build`, `dev` (watch), `typecheck`, `test` (Vitest, `test/`). Build before consuming from another workspace.
