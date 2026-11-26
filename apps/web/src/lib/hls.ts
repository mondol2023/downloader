import { createStreamGrant, type StreamGrantPayload } from "@media/shared";

function childToken(grant: StreamGrantPayload, target: URL, secret: string): string {
  const ttl = Math.max(60, grant.exp - Math.floor(Date.now() / 1000));
  return createStreamGrant(
    {
      url: target.toString(),
      sub: grant.sub,
      tier: grant.tier,
      mediaId: grant.mediaId,
      formatId: grant.formatId,
      mime: null,
      manifest: /\.m3u8?$/i.test(target.pathname),
    },
    secret,
    ttl,
  );
}

/** Points every URI in an HLS playlist back at this route. */
export function rewriteManifest(text: string, base: URL, grant: StreamGrantPayload, secret: string): string {
  const proxied = (ref: string) => {
    let target: URL;
    try {
      target = new URL(ref, base);
    } catch {
      return ref;
    }
    return /^https?:$/.test(target.protocol) ? `/api/stream/${childToken(grant, target, secret)}` : ref;
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;
      if (line.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => `URI="${proxied(uri)}"`);
      return proxied(line.trim());
    })
    .join("\n");
}
