import { createServer, type Server } from "node:http";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { Rule } from "@media/shared";
import { MOCK_ADMIN_ME, MOCK_GUEST_ME } from "../src/mocks/media";
import type { PolicyAdminResponse, SoftPolicy } from "../src/features/admin/policy/types";
import { PLATFORM_IDS } from "../src/features/admin/policy/types";
import { fail, mock, ok, stubSession } from "./helpers";

// Same stand-in API as admin-policy.spec.ts: the admin layout checks the role on the Next server.
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
  rules: [],
  disabledBuiltins: [],
};

const shorts: Rule = { id: "r-shorts", name: "No shorts", type: "block_url_pattern", enabled: true, params: { pattern: "*/shorts/*" } };

type Published = { overrides: { rules?: Rule[]; disabledBuiltins?: string[]; global?: unknown }; note: string };

/** Mocked admin API holding the rules and disabled built-ins; publishing replaces them. */
async function setup(page: Page, context: BrowserContext, seed: { rules?: Rule[]; disabledBuiltins?: string[] } = {}) {
  let rules = seed.rules ?? [];
  let disabled = seed.disabledBuiltins ?? [];
  let version = 1;
  const published: Published[] = [];
  const body = (): PolicyAdminResponse => ({
    active: { ...structuredClone(base), rules, disabledBuiltins: disabled as SoftPolicy["disabledBuiltins"], version },
    defaults: { ...structuredClone(base), version: 0 },
    hardFloor: {
      refuse: ["SOURCE_PRIVATE", "SOURCE_MEMBERS_ONLY", "SOURCE_NEEDS_LOGIN", "SOURCE_DRM"],
      blockedHosts: ["netflix.com"],
      maxAgeLimit: 17,
    },
    versions: [{ version, note: "initial", createdBy: "root@example.com", createdAt: "2026-11-01T00:00:00Z", active: true }],
  });
  await context.addCookies([{ name: "mg_test_role", value: "admin", url: `http://localhost:${process.env.E2E_PORT ?? 3000}` }]);
  await stubSession(page, MOCK_ADMIN_ME);
  await mock(page, "GET", "/admin/policy", () => ok(body()));
  await mock(page, "POST", "/admin/policy", (route) => {
    const sent = route.request().postDataJSON() as Published;
    published.push(sent);
    rules = sent.overrides.rules ?? [];
    disabled = sent.overrides.disabledBuiltins ?? [];
    version += 1;
    return ok({ version }, 201);
  });
  return { published };
}

const review = (page: Page) => page.getByRole("button", { name: /^Review changes/ });
const diff = (page: Page) => page.getByTestId("diff-row");

test("locked rows have no controls", async ({ page, context }) => {
  test.skip(busy, "needs the stub API; a real API owns the port");
  await setup(page, context);
  await page.goto("/admin/restrictions");
  const locked = page.getByTestId("locked-rule");
  for (const name of ["Private", "Members-only", "Login required", "DRM", "Age 18+"]) {
    await expect(locked.filter({ hasText: name })).toHaveCount(1);
  }
  await expect(locked.getByRole("switch")).toHaveCount(0);
  await expect(locked.getByRole("button")).toHaveCount(0);
});

test("add a URL-pattern rule and publish it", async ({ page, context }) => {
  test.skip(busy, "needs the stub API; a real API owns the port");
  const { published } = await setup(page, context);
  await page.goto("/admin/restrictions");
  await page.getByRole("button", { name: "Add rule" }).click();
  await page.getByRole("button", { name: /Block URL pattern/ }).click();
  await page.getByLabel("Name", { exact: true }).fill("No shorts");
  await page.getByLabel("Pattern").fill("*/shorts/*");
  await page.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByText("1 unpublished change")).toBeVisible();
  await review(page).click();
  await expect(diff(page)).toContainText("Added: No shorts");
  await page.getByLabel(/^Note/).fill("no shorts");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("policy v2")).toBeVisible();
  expect(published[0]!.overrides.rules).toEqual([
    { id: expect.any(String), name: "No shorts", type: "block_url_pattern", enabled: true, params: { pattern: "*/shorts/*" } },
  ]);
});

test("edit, disable and delete a rule", async ({ page, context }) => {
  test.skip(busy, "needs the stub API; a real API owns the port");
  await setup(page, context, { rules: [shorts] });
  await page.goto("/admin/restrictions");
  const row = page.getByTestId("rule-row-r-shorts");

  await row.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name", { exact: true }).fill("No shorts v2");
  await page.getByRole("button", { name: "Save rule" }).click();
  await review(page).click();
  await expect(diff(page)).toContainText("Edited: No shorts v2");
  await page.keyboard.press("Escape");

  await row.getByRole("switch", { name: "Enabled" }).uncheck();
  await review(page).click();
  await expect(diff(page)).toContainText("Disabled: No shorts v2");
  await page.keyboard.press("Escape");

  await row.getByRole("button", { name: "Delete" }).click();
  await row.getByRole("button", { name: "Confirm delete" }).click();
  await review(page).click();
  await expect(diff(page)).toContainText("Removed: No shorts");
});

test("disabling a built-in keeps its value", async ({ page, context }) => {
  test.skip(busy, "needs the stub API; a real API owns the port");
  const { published } = await setup(page, context);
  await page.goto("/admin/restrictions");
  await page.getByTestId("builtin-maxDuration").getByRole("switch", { name: "Enabled" }).uncheck();
  await review(page).click();
  await expect(diff(page)).toContainText("Built-in disabled: maxDuration");
  await page.getByLabel(/^Note/).fill("lift duration cap");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("policy v2")).toBeVisible();
  expect(published[0]!.overrides).toEqual({ disabledBuiltins: ["maxDuration"] });
});

test("a 422 lands on the rule field", async ({ page, context }) => {
  test.skip(busy, "needs the stub API; a real API owns the port");
  const bad: Rule = { id: "r-long", name: "Too long", type: "max_duration", enabled: true, params: { seconds: 0 } };
  await setup(page, context, { rules: [bad] });
  await mock(page, "POST", "/admin/policy", fail(422, "POLICY_INVALID", "Invalid policy", {
    details: [{ path: "rules.0.params.seconds", message: "Number must be greater than 0" }],
  }));
  await page.goto("/admin/restrictions");
  const row = page.getByTestId("rule-row-r-long");
  await row.getByRole("switch", { name: "Enabled" }).uncheck();
  await review(page).click();
  await page.getByLabel(/^Note/).fill("x");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "failed validation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row).toContainText("Has errors");
  await row.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByTestId("field-error")).toHaveText("Number must be greater than 0");
});

test("the test panel names the rule", async ({ page, context }) => {
  test.skip(busy, "needs the stub API; a real API owns the port");
  await setup(page, context, { rules: [shorts] });
  const refused = {
    allowed: false,
    refusal: { code: "SOURCE_RULE_BLOCKED", message: "No." },
    formats: null,
    rule: { id: "r-shorts", name: "No shorts" },
    blockedActions: [],
  };
  await mock(page, "POST", "/admin/policy/preview", ok({
    mediaId: "m",
    cached: true,
    active: { ...refused, allowed: true, refusal: null, rule: null },
    draft: refused,
  }));
  await page.goto("/admin/restrictions");
  await page.getByTestId("rule-row-r-shorts").getByRole("switch", { name: "Enabled" }).uncheck();
  await review(page).click();
  await page.getByLabel("URL to test").fill("https://www.youtube.com/shorts/abc");
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await expect(page.getByTestId("verdict-draft")).toContainText("No shorts");
});
