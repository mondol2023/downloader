import { lookup } from "node:dns/promises";
import type { NextRequest } from "next/server";
import { assertHostAllowed, isPrivateHostname, StreamGrantError, verifyStreamGrant, type StreamGrantPayload } from "@media/shared";
import { rewriteManifest } from "@/lib/hls";

/**
 * Byte proxy for playback grants minted by `POST /api/v1/media/playback`.
 *
 * The browser only ever holds an opaque HMAC-signed grant; the upstream CDN URL stays here. Every
 * hop is checked against the private-host rule and the allow-list, redirects are followed by hand
 * (so a 302 to an internal address can't slip through), and HLS manifests are rewritten so child
 * playlists and segments come back through this same route under fresh signed grants.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_HOPS = 4;
const HEADER_TIMEOUT_MS = 15_000;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const PASS_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"] as const;

const allowlist = () => (process.env.ALLOWED_STREAM_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const reply = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { code: "STREAM_REFUSED", message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/** Host checks plus a DNS check, so a public-looking name that resolves to an internal address is refused. */
async function assertFetchable(url: URL): Promise<void> {
  if (!/^https?:$/.test(url.protocol)) throw new StreamGrantError("Unsupported protocol", "HOST_NOT_ALLOWED");
  assertHostAllowed(url.hostname, allowlist());
  const literal = /^[\d.]+$|:/.test(url.hostname.replace(/^\[|\]$/g, ""));
  if (literal) return;
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.some((a) => isPrivateHostname(a.address))) {
    throw new StreamGrantError(`Refusing to proxy ${url.hostname}`, "HOST_NOT_ALLOWED");
  }
}

async function fetchUpstream(start: string, range: string | null, signal: AbortSignal): Promise<{ res: Response; finalUrl: URL }> {
  let url = new URL(start);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    await assertFetchable(url);
    const timer = new AbortController();
    const t = setTimeout(() => timer.abort(), HEADER_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.any([signal, timer.signal]),
        headers: { "user-agent": "Mozilla/5.0 (compatible; MediaEngine/1.0)", ...(range ? { range } : {}) },
      });
    } finally {
      clearTimeout(t); // the timeout guards the headers only, not the body stream
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    return { res, finalUrl: url };
  }
  throw new StreamGrantError("Too many redirects", "HOST_NOT_ALLOWED");
}

const looksLikeManifest = (contentType: string | null, url: URL) =>
  /mpegurl/i.test(contentType ?? "") || /\.m3u8?$/i.test(url.pathname);

export async function GET(req: NextRequest, ctx: RouteContext<"/api/stream/[token]">) {
  const secret = process.env.STREAM_SIGNING_SECRET;
  if (!secret) return reply(503, "Playback isn't configured on this server.");
  const { token } = await ctx.params;

  let grant: StreamGrantPayload;
  try {
    grant = verifyStreamGrant(token, secret);
  } catch (err) {
    const expired = err instanceof StreamGrantError && err.code === "EXPIRED";
    return reply(expired ? 410 : 403, expired ? "This playback link has expired. Press play again." : "This playback link isn't valid.");
  }

  try {
    const { res, finalUrl } = await fetchUpstream(grant.url, req.headers.get("range"), req.signal);

    if (grant.manifest && res.ok && looksLikeManifest(res.headers.get("content-type"), finalUrl)) {
      const text = await res.text();
      if (text.length > MAX_MANIFEST_BYTES) return reply(502, "The playlist was too large.");
      return new Response(rewriteManifest(text, finalUrl, grant, secret), {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl", "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
      });
    }

    const headers = new Headers({ "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
    for (const h of PASS_HEADERS) {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    }
    const type = headers.get("content-type");
    if (grant.mime && (!type || /octet-stream|text\/plain/i.test(type))) headers.set("content-type", grant.mime);
    return new Response(res.body, { status: res.status, headers });
  } catch (err) {
    if (err instanceof StreamGrantError) return reply(403, "That source can't be played here.");
    if (req.signal.aborted) return new Response(null, { status: 499 });
    return reply(502, "The source didn't respond. Try again, or download it instead.");
  }
}
