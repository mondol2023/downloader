import { INELIGIBLE_CODES, type IneligibleCode } from "@media/shared";
import type { PublicCmsBlock } from "./server";

export const BANNER_KEY = "announcement.banner";
export const REFUSAL_KEYS = INELIGIBLE_CODES.map((c) => `refusal.${c}`);

export type RefusalOverrides = Partial<Record<IneligibleCode, { title?: string; body: string }>>;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'", "&nbsp;": " " };
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();

/**
 * A `refusal.<CODE>` block overrides that code's copy. A leading heading becomes the title and the rest the body;
 * with no heading only the body is replaced and the default title stays.
 */
export function refusalOverrides(blocks: PublicCmsBlock[]): RefusalOverrides {
  const out: RefusalOverrides = {};
  for (const b of blocks) {
    const code = b.key.startsWith("refusal.") ? b.key.slice("refusal.".length) : "";
    if (!(INELIGIBLE_CODES as readonly string[]).includes(code)) continue;
    const heading = /^\s*<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(b.html);
    const body = text(heading ? b.html.slice(heading[0].length) : b.html);
    if (!body) continue;
    out[code as IneligibleCode] = { title: heading ? text(heading[1] ?? "") || undefined : undefined, body };
  }
  return out;
}
