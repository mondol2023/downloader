import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";

/**
 * The public site renders CMS pages on the server, so page.route can't stand in for the API. A stub API on
 * E2E_CMS_STUB_PORT (wired into the dev server's env by playwright.config.ts) plays the published state.
 * If the dev server was already running with a different API_INTERNAL_URL these specs skip.
 */
const STUB_PORT = Number(process.env.E2E_CMS_STUB_PORT ?? 4010);
const ASSET = `http://localhost:${STUB_PORT}/api/v1/cms/assets/00000000-0000-0000-0000-000000000000.webp`;

const PAGES: Record<string, { title: string; html: string }> = {
  "e2e-rich": {
    title: "Rich page",
    html: [
      "<h2>Section heading</h2>",
      '<p><span style="color:#d6336c">coloured words</span></p>',
      "<table><thead><tr><th>Col A</th><th>Col B</th></tr></thead><tbody><tr><td>a1</td><td>b1</td></tr></tbody></table>",
      `<img src="${ASSET}" alt="a fixture image">`,
    ].join(""),
  },
  // What the API would never store, served anyway: the web side's own sanitiser is the defence in depth.
  "e2e-xss": {
    title: "XSS page",
    html: [
      "<p>safe text stays</p>",
      "<img src=x onerror=\"alert('img')\">",
      "<a href=\"javascript:alert('a')\">bad link</a>",
      "<script>alert('script')</script>",
      "<iframe src=\"https://evil.example/x\"></iframe>",
      "<span style=\"position:fixed;background:url(x)\">styled</span>",
    ].join(""),
  },
};

let server: Server | undefined;
let stubbed = false;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    const m = /^\/api\/v1\/cms\/pages\/([^/]+)$/.exec(url.pathname);
    const page = m ? PAGES[decodeURIComponent(m[1]!)] : undefined;
    res.setHeader("content-type", "application/json");
    if (!page) {
      res.statusCode = url.pathname.startsWith("/api/v1/cms/") ? (m ? 404 : 200) : 404;
      res.end(JSON.stringify(m ? { error: { code: "NOT_FOUND", message: "Page not found" } } : { data: [] }));
      return;
    }
    res.end(JSON.stringify({ data: { ...page, seo: { title: null, description: null, ogImageId: null }, updatedAt: new Date().toISOString() } }));
  });
  stubbed = await new Promise<boolean>((resolve) => {
    server!.once("error", () => resolve(false));
    server!.listen(STUB_PORT, () => resolve(true));
  });
});
test.afterAll(() => new Promise<void>((resolve) => (server?.listening ? server.close(() => resolve()) : resolve())));

test("a published page shows its heading, coloured text, table and image", async ({ page }) => {
  test.skip(!stubbed, "stub API port is busy");
  const res = await page.goto("/p/e2e-rich");
  test.skip(res?.status() === 404, "dev server isn't pointed at the stub API (restart it via playwright)");
  const body = page.locator(".cms-content");
  await expect(body.getByRole("heading", { name: "Section heading" })).toBeVisible();
  await expect(body.getByText("coloured words")).toHaveCSS("color", "rgb(214, 51, 108)");
  await expect(body.getByRole("table")).toContainText("b1");
  await expect(body.getByRole("img", { name: "a fixture image" })).toHaveAttribute("src", ASSET);
});

test("an unknown page is a 404", async ({ page }) => {
  test.skip(!stubbed, "stub API port is busy");
  const res = await page.goto("/p/does-not-exist");
  expect(res?.status()).toBe(404);
});

test("hostile HTML is neutralised: no script runs, safe text survives", async ({ page }) => {
  test.skip(!stubbed, "stub API port is busy");
  let dialog = false;
  page.on("dialog", (d) => {
    dialog = true;
    void d.dismiss();
  });
  const res = await page.goto("/p/e2e-xss");
  test.skip(res?.status() === 404, "dev server isn't pointed at the stub API (restart it via playwright)");
  const body = page.locator(".cms-content");
  await expect(body.getByText("safe text stays")).toBeVisible();
  await page.waitForTimeout(500);
  expect(dialog).toBe(false);
  await expect(body.locator("script, iframe, [onerror]")).toHaveCount(0);
  await expect(body.locator('a[href^="javascript:" i]')).toHaveCount(0);
  await expect(body.locator('[style*="position"]')).toHaveCount(0);
});

test("revalidate endpoint rejects callers without the secret", async ({ request }) => {
  expect((await request.post("/api/revalidate", { data: { slug: "terms" } })).status()).toBe(403);
  expect((await request.post("/api/revalidate", { data: { slug: "terms" }, headers: { "x-revalidate-secret": "wrong" } })).status()).toBe(403);
});
