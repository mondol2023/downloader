import { expect, test } from "@playwright/test";
import { createStreamGrant, verifyStreamGrant } from "@media/shared";
import { rewriteManifest } from "../src/lib/hls";

const secret = process.env.STREAM_SIGNING_SECRET;
const mint = (url: string, ttl = 600, manifest = false) =>
  createStreamGrant({ url, sub: "guest:test", tier: "GUEST", mediaId: "m", formatId: "22", mime: "video/mp4", manifest }, secret!, ttl);

test.describe("stream proxy (/api/stream/:token)", () => {
  test.skip(!secret, "STREAM_SIGNING_SECRET not set (repo-root .env)");

  test("rejects a tampered or unsigned token", async ({ request }) => {
    const res = await request.get("/api/stream/not-a-grant");
    expect(res.status()).toBe(403);
    const forged = mint("https://example.com/v.mp4").replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await request.get(`/api/stream/${forged}`)).status()).toBe(403);
  });

  test("an expired grant says to press play again", async ({ request }) => {
    const res = await request.get(`/api/stream/${mint("https://example.com/v.mp4", -5)}`);
    expect(res.status()).toBe(410);
    expect((await res.json()).error.message).toContain("Press play again");
  });

  test("a validly signed grant for an internal address is still refused", async ({ request }) => {
    for (const url of ["http://127.0.0.1:4000/healthz", "http://localhost/x", "http://169.254.169.254/latest/meta-data"]) {
      expect((await request.get(`/api/stream/${mint(url)}`)).status(), url).toBe(403);
    }
  });
});

test("rewriteManifest points every playlist URI back through the proxy under a fresh grant", () => {
  test.skip(!secret, "STREAM_SIGNING_SECRET not set (repo-root .env)");
  const parent = verifyStreamGrant(mint("https://cdn.example.com/a/master.m3u8", 600, true), secret!);
  const out = rewriteManifest(
    ['#EXTM3U', '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"', "#EXTINF:4.0,", "seg1.ts", "https://other.example.com/hi/index.m3u8", ""].join("\n"),
    new URL("https://cdn.example.com/a/master.m3u8"),
    parent,
    secret!,
  );
  const lines = out.split("\n");
  expect(lines[0]).toBe("#EXTM3U");
  const urls = [/URI="(\/api\/stream\/[^"]+)"/.exec(lines[1]!)![1]!, lines[3]!, lines[4]!];
  const grants = urls.map((u) => verifyStreamGrant(u.replace("/api/stream/", ""), secret!));
  expect(grants.map((g) => g.url)).toEqual([
    "https://cdn.example.com/a/key.bin",
    "https://cdn.example.com/a/seg1.ts",
    "https://other.example.com/hi/index.m3u8",
  ]);
  expect(grants.map((g) => g.manifest)).toEqual([false, false, true]); // only playlists get rewritten again
  expect(grants.every((g) => g.sub === "guest:test" && g.tier === "GUEST")).toBe(true);
});
