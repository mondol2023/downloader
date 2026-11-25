import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { INELIGIBLE_COPY } from "@media/shared";
import { MOCK_ADMIN_ME, MOCK_GUEST_ME, mockExtract } from "../src/mocks/media";
import type { PolicyAdminResponse, SoftPolicy } from "../src/features/admin/policy/types";
import { PLATFORM_IDS } from "../src/features/admin/policy/types";
import { fail, mock, ok, stubSession } from "./helpers";

// The admin layout checks the role on the Next server, which page.route can't intercept:
// stand in for the API there (same trick as admin-guard.spec.ts).
const url = new URL(process.env.API_INTERNAL_URL ?? "http://localhost:4000");
let server: Server | null = null;
let busy = false;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    const me = /mg_test_role=admin/.test(req.headers.cookie ?? "") ? MOCK_ADMIN_ME : MOCK_GUEST_ME;
    res.end(JSON.stringify({ data: req.url?.startsWith("/api/v1/auth/me") ? me : [] }));
  });
  await new Promise<void>((resolve) => {
    server!.once("error", () => {
      busy = true;
      resolve();
    });
    server!.listen(Number(url.port || 80), resolve);
  });
});
test.afterAll(() => new Promise<void>((r) => (server && !busy ? server.close(() => r()) : r())));

const platforms = Object.fromEntries(
  PLATFORM_IDS.map((id) => [id, { enabled: true, download: true, playback: true, maxHeight: null, note: "" }]),
);
const base: SoftPolicy = {
  global: {
    maintenanceMode: false, maintenanceMessage: "", extractionEnabled: true, downloadsEnabled: true,
    maxDurationSec: 14400, allowLiveVod: true, ageLimitMax: 17, extraBlockedHosts: [],
  },
  tiers: { GUEST: { maxHeight: 480 }, FREE: { maxHeight: 720 }, PRO: { maxHeight: 2160 } },
  platforms,
};

/** A tiny in-memory policy store behind the mocked admin API. */
function policyStore() {
  const versions = [{ version: 1, note: "initial", createdBy: "root@example.com", createdAt: "2026-11-01T00:00:00Z", active: true, tiktok: true }];
  const current = () => versions.find((v) => v.active)!;
  const body = (): PolicyAdminResponse => {
    const active = structuredClone(base);
    active.platforms.tiktok!.enabled = current().tiktok;
    return {
      active: { ...active, version: current().version },
      defaults: { ...structuredClone(base), version: 0 },
      hardFloor: { refuse: ["SOURCE_PRIVATE", "SOURCE_DRM"], blockedHosts: ["netflix.com"], maxAgeLimit: 17 },
      versions: [...versions].reverse().map((v) => ({ version: v.version, note: v.note, createdBy: v.createdBy, createdAt: v.createdAt, active: v.active })),
    };
  };
  const activate = (v: (typeof versions)[number]) => {
    versions.forEach((x) => (x.active = false));
    v.active = true;
  };
  return {
    body,
    tiktokEnabled: () => current().tiktok,
    publish(overrides: { platforms?: { tiktok?: { enabled?: boolean } } }, note: string) {
      const v = { version: versions.length + 1, note, createdBy: "root@example.com", createdAt: new Date().toISOString(), active: false, tiktok: overrides.platforms?.tiktok?.enabled ?? true };
      versions.push(v);
      activate(v);
    },
    rollback(version: number) {
      const v = versions.find((x) => x.version === version);
      if (v) activate(v);
    },
  };
}

test("disable TikTok → publish → users are refused → roll back → it works again", async ({ browser, context, page }) => {
  test.skip(busy, "needs the stub API; a real API owns the port");
  const store = policyStore();
  let published: unknown;

  await context.addCookies([{ name: "mg_test_role", value: "admin", url: `http://localhost:${process.env.E2E_PORT ?? 3000}` }]);
  await stubSession(page, MOCK_ADMIN_ME);
  await mock(page, "GET", "/admin/policy", () => ok(store.body()));
  await mock(page, "POST", "/admin/policy", (route) => {
    const sent = route.request().postDataJSON() as { overrides: object; note: string };
    published = sent;
    store.publish(sent.overrides, sent.note);
    return ok({ version: store.body().active.version }, 201);
  });
  await mock(page, "POST", "/admin/policy/1/activate", () => {
    store.rollback(1);
    return ok({ version: 1 });
  });

  // A normal user on a separate context: it shares only the mocked server state.
  const userCtx = await browser.newContext();
  const user = await userCtx.newPage();
  await stubSession(user);
  await mock(user, "POST", "/media/extract", () =>
    store.tiktokEnabled() ? ok(mockExtract()) : fail(403, "SOURCE_PLATFORM_DISABLED", "raw server text"),
  );
  await mock(user, "GET", "/media/mock-media", ok(mockExtract()));
  const extract = async () => {
    await user.goto("/");
    await user.getByLabel("Media URL").fill("https://www.tiktok.com/@a/video/1");
    await user.getByRole("button", { name: "Get formats" }).click();
  };

  // 1. Admin disables TikTok and publishes it.
  await page.goto("/admin/sites");
  await expect(page.getByTestId("hard-floor")).toContainText("enforced in code");
  await page.getByTestId("site-tiktok").getByRole("switch", { name: "Enabled" }).uncheck();
  await page.getByRole("button", { name: "Review changes (1)" }).click();
  await expect(page.getByTestId("diff-row")).toContainText("platforms.tiktok.enabled");
  await page.getByLabel(/^Note/).fill("pause tiktok");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("policy v2")).toBeVisible();
  expect(published).toEqual({ overrides: { platforms: { tiktok: { enabled: false } } }, note: "pause tiktok" });

  // 2. A user is refused, with the shared copy, within 5 s.
  await extract();
  const refusal = user.getByTestId("refusal");
  await expect(refusal).toHaveAttribute("data-code", "SOURCE_PLATFORM_DISABLED", { timeout: 5000 });
  await expect(refusal).toContainText(INELIGIBLE_COPY.SOURCE_PLATFORM_DISABLED.title);

  // 3. Roll back from History.
  await page.getByRole("tab", { name: "History" }).click();
  await page.getByRole("button", { name: "Roll back to version 1" }).click();
  await expect(page.getByTestId("policy-version").first().getByText("v1")).toBeVisible();
  await expect(page.getByText("policy v1")).toBeVisible();

  // 4. The same link works again.
  await extract();
  await expect(user).toHaveURL(/\/m\/mock-media$/, { timeout: 5000 });
  await userCtx.close();
});

test("a 422 shows its message next to the field", async ({ page, context }) => {
  test.skip(busy, "needs the stub API; a real API owns the port");
  const store = policyStore();
  await context.addCookies([{ name: "mg_test_role", value: "admin", url: `http://localhost:${process.env.E2E_PORT ?? 3000}` }]);
  await stubSession(page, MOCK_ADMIN_ME);
  await mock(page, "GET", "/admin/policy", () => ok(store.body()));
  await mock(page, "POST", "/admin/policy", fail(422, "POLICY_INVALID", "Invalid policy", {
    details: [{ path: "global.maxDurationSec", message: "Number must be greater than 0" }],
  }));

  await page.goto("/admin/restrictions");
  await page.getByLabel("Max duration (seconds)").fill("100");
  await page.getByRole("button", { name: "Review changes (1)" }).click();
  await page.getByLabel(/^Note/).fill("too short");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByTestId("field-error")).toHaveText("Number must be greater than 0");
});
