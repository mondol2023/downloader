import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { blockTag, pageTag } from "@/features/cms/render/server";

const SLUG = /^[A-Za-z0-9._-]{1,80}$/;

function authorised(req: Request): boolean {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return false; // unset = endpoint disabled, never open
  const given = Buffer.from(req.headers.get("x-revalidate-secret") ?? "");
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** Called by the API on publish/unpublish/edit: `{ slug?: string, blockKey?: string }`. */
export async function POST(req: Request) {
  if (!authorised(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { slug?: unknown; blockKey?: unknown } | null;
  const tags: string[] = [];
  if (typeof body?.slug === "string" && SLUG.test(body.slug)) tags.push(pageTag(body.slug));
  if (typeof body?.blockKey === "string" && SLUG.test(body.blockKey)) tags.push(blockTag(body.blockKey));
  if (tags.length === 0) return Response.json({ error: "slug or blockKey required" }, { status: 400 });
  // "max": stale-while-revalidate, so a visitor never waits on the API.
  for (const t of tags) revalidateTag(t, "max");
  return Response.json({ revalidated: tags });
}
