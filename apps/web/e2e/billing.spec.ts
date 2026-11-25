import { expect, test } from "@playwright/test";
import { MOCK_PLANS, MOCK_USER_ME } from "../src/mocks/media";
import { alert, fail, mock, ok, stubSession } from "./helpers";

test("pricing compares GUEST / FREE / PRO and reads null as unlimited", async ({ page }) => {
  await stubSession(page);
  await mock(page, "GET", "/billing/plans", ok(MOCK_PLANS));
  await page.goto("/pricing");

  const grid = page.getByTestId("pricing-grid");
  await expect(grid.locator('[data-tier="GUEST"]')).toContainText("720p");
  await expect(grid.locator('[data-tier="FREE"]')).toContainText("1080p");
  await expect(grid.locator('[data-tier="PRO"]')).toContainText("Up to 8K");
  await expect(grid.locator('[data-tier="PRO"]')).toContainText("Unlimited");
  await expect(grid.locator('[data-tier="PRO"]')).toContainText("$9.00");
  await page.getByRole("radio", { name: "Yearly" }).click();
  await expect(grid.locator('[data-tier="PRO"]')).toContainText("$79.00");
  await expect(grid.getByRole("link", { name: "Sign up to upgrade" })).toBeVisible();
});

test("a signed-in user starts checkout for the selected plan", async ({ page }) => {
  await stubSession(page, MOCK_USER_ME);
  await mock(page, "GET", "/billing/plans", ok(MOCK_PLANS));
  let body: unknown;
  await mock(page, "POST", "/billing/checkout", (route) => {
    body = route.request().postDataJSON();
    return ok({ url: "/pricing?checkout=started" });
  });
  await page.goto("/pricing");
  await page.getByRole("radio", { name: "Yearly" }).click();
  await page.getByRole("button", { name: "Upgrade to Pro" }).click();
  await expect(page).toHaveURL(/checkout=started/);
  expect(body).toEqual({ plan: "pro-yearly" });
});

test("billing off says Pro isn't open yet instead of a dead button", async ({ page }) => {
  await stubSession(page, MOCK_USER_ME);
  await mock(page, "GET", "/billing/plans", ok({ ...MOCK_PLANS, plans: [], billingEnabled: false }));
  await page.goto("/pricing");
  await expect(page.getByText("Pro isn't open for sign-up yet")).toBeVisible();
});

test("account billing: no subscription points to plans; active opens the portal", async ({ page }) => {
  await stubSession(page, MOCK_USER_ME);
  await mock(page, "GET", "/billing/subscription", ok(null));
  await page.goto("/account/billing");
  await expect(page.getByTestId("billing-card")).toContainText("You're on the Free plan");
  await expect(page.getByRole("link", { name: "Compare plans" })).toBeVisible();

  await mock(page, "GET", "/billing/subscription", ok({ status: "active", priceId: "p", currentPeriodEnd: "2026-12-25T00:00:00.000Z", cancelAtPeriodEnd: false }));
  await mock(page, "POST", "/billing/portal", fail(503, "DEGRADED", "down"));
  await page.reload();
  await page.getByRole("button", { name: "Manage billing" }).click();
  await expect(alert(page)).toContainText("Billing is paused for a moment");
});

test("account billing asks guests to sign in", async ({ page }) => {
  await stubSession(page);
  await page.goto("/account/billing");
  await expect(page.getByRole("link", { name: "Sign in" }).last()).toBeVisible();
  await expect(page.getByText("Sign in to see your plan")).toBeVisible();
});
