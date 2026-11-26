import { sanitize } from "@media/rich-text";

/** Server-only helpers for the public CMS. The API is reached over the internal URL, never the browser. */

const API = (process.env.API_INTERNAL_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")).replace(/\/+$/, "");
export const REVALIDATE_SECONDS = 300;

export const pageTag = (slug: string) => `cms:${slug}`;
export const blockTag = (key: string) => `cms:block:${key}`;

/** Same default the API uses, so images that passed its sanitiser pass ours. */
function assetOrigin(): string {
  const configured = process.env.CMS_ASSET_ORIGIN;
  if (configured) return configured.replace(/\/+$/, "");
  return `${(process.env.API_PUBLIC_URL ?? "http://localhost:4000").replace(/\/+$/, "")}/api/v1/cms/assets`;
}

/** Defence in depth: the API already sanitised on save; sanitise again on read. */
export const cleanHtml = (html: string) => sanitize(html, { assetOrigin: assetOrigin() });

export interface PublicCmsPage {
  title: string;
  html: string;
  seo: { title: string | null; description: string | null; ogImageId: string | null };
  updatedAt: string;
}

/** Null on 404 and when the API is unreachable with nothing cached; Next keeps serving the last good render otherwise. */
export async function getCmsPage(slug: string): Promise<PublicCmsPage | null> {
  try {
    const res = await fetch(`${API}/api/v1/cms/pages/${encodeURIComponent(slug)}`, {
      next: { revalidate: REVALIDATE_SECONDS, tags: [pageTag(slug)] },
    });
    if (!res.ok) return null;
    const { data } = (await res.json()) as { data: PublicCmsPage };
    return { ...data, html: cleanHtml(data.html) };
  } catch {
    return null;
  }
}

export interface PublicCmsBlock {
  key: string;
  html: string;
}

/** One request for a set of keys (the API caps it at 20). Missing keys are simply absent. */
export async function getCmsBlocks(keys: string[]): Promise<PublicCmsBlock[]> {
  if (keys.length === 0) return [];
  try {
    const res = await fetch(`${API}/api/v1/cms/blocks?keys=${encodeURIComponent(keys.join(","))}`, {
      next: { revalidate: REVALIDATE_SECONDS, tags: keys.map(blockTag) },
    });
    if (!res.ok) return [];
    const { data } = (await res.json()) as { data: PublicCmsBlock[] };
    return data.map((b) => ({ key: b.key, html: cleanHtml(b.html) }));
  } catch {
    return [];
  }
}
