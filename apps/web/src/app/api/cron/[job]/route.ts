import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // unset = cron disabled, never open
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** Vercel Cron replacements for the timers that used to live in the long-running API/worker. */
export async function GET(req: Request, ctx: { params: Promise<{ job: string }> }) {
  if (!authorised(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { job } = await ctx.params;
  const api = await import("@media/api/dist/serverless.js");
  if (job === "prune-tokens") return Response.json({ pruned: await api.pruneExpiredRefreshTokens() });
  if (job === "cms-publish") return Response.json({ published: await api.publishDuePages() });
  return Response.json({ error: "unknown job" }, { status: 404 });
}
