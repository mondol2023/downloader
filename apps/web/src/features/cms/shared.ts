import type { JSONContent } from "@media/rich-text";

export interface CmsPageRow {
  id: string;
  slug: string;
  title: string;
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  version: number;
  publishAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  createdAt: string;
  updatedById?: string;
}

export interface CmsPage extends CmsPageRow {
  contentJson: JSONContent;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageId: string | null;
}

export interface CmsRevision {
  id: string;
  version: number;
  title: string;
  contentJson: JSONContent;
  authorId: string;
  createdAt: string;
}

export interface CmsAssetRow {
  id: string;
  key: string;
  url: string;
  mime: string;
  bytes: number;
  alt: string;
  createdAt: string;
}

export interface CmsBlockRow {
  key: string;
  contentJson: JSONContent;
  updatedAt: string;
}

export const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

/** Origin that `<img src>` must come from; set NEXT_PUBLIC_CMS_ASSET_ORIGIN when assets live on a CDN. */
export function assetOrigin(): string {
  const env = process.env.NEXT_PUBLIC_CMS_ASSET_ORIGIN;
  if (env) return env.replace(/\/+$/, "");
  const base = typeof window === "undefined" ? "" : window.location.origin;
  return `${base}/api/v1/cms/assets`;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
