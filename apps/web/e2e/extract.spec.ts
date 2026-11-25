import { expect, test } from "@playwright/test";
import { INELIGIBLE_COPY } from "@media/shared";
import { mockExtract } from "../src/mocks/media";
import { alert, fail, mock, ok, stubSession } from "./helpers";

test.beforeEach(async ({ page }) => {
  await stubSession(page);
});

test("idle → typing → seated chip → extracting → formats page", async ({ page }) => {
  await mock(page, "POST", "/media/extract", async () => {
    await new Promise((r) => setTimeout(r, 300));
    return ok(mockExtract());
  });
  await mock(page, "GET", "/media/mock-media", ok(mockExtract()));
  await page.goto("/");
  const form = page.locator("form[data-status]");
  await expect(form).toHaveAttribute("data-status", "idle");
  await expect(page.getByRole("button", { name: "Get formats" })).toBeDisabled();

  await page.getByLabel("Media URL").fill("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
  await expect(form).toHaveAttribute("data-status", "typing");
  await expect(page.getByTestId("platform-chip")).toHaveText("youtube.com");

  await page.getByRole("button", { name: "Get formats" }).click();
  await expect(page.getByTestId("extract-skeleton")).toBeVisible();
  await expect(page).toHaveURL(/\/m\/mock-media$/);
});

test("an invalid link gets guidance, not blame", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Media URL").fill("not a link");
  await page.getByLabel("Media URL").press("Enter");
  await expect(alert(page)).toContainText("doesn't look like a web link");
});

test("a private video is refused with INELIGIBLE_COPY verbatim", async ({ page }) => {
  await mock(page, "POST", "/media/extract", fail(403, "SOURCE_PRIVATE", "raw server text"));
  await page.goto("/");
  await page.getByLabel("Media URL").fill("https://www.youtube.com/watch?v=private1");
  await page.getByRole("button", { name: "Get formats" }).click();
  const refusal = page.getByTestId("refusal");
  await expect(refusal).toHaveAttribute("data-code", "SOURCE_PRIVATE");
  await expect(refusal).toContainText(INELIGIBLE_COPY.SOURCE_PRIVATE.title);
  await expect(refusal).toContainText(INELIGIBLE_COPY.SOURCE_PRIVATE.body);
  await expect(refusal).toContainText("Try a public link");
  await expect(refusal).not.toContainText("raw server text");
});

test("degraded mode shows a banner and keeps the deck usable", async ({ page }) => {
  await mock(page, "POST", "/media/extract", fail(503, "DEGRADED", "database down"));
  await page.goto("/");
  await page.getByLabel("Media URL").fill("https://vimeo.com/1084537");
  await page.getByRole("button", { name: "Get formats" }).click();
  await expect(page.getByTestId("degraded-banner")).toBeVisible();
  await expect(page.getByLabel("Media URL")).toBeEnabled();
});

// Needs the real stack (API + Redis + yt-dlp + network): E2E_LIVE=1 npx playwright test
test("live: Big Buck Bunny extract → formats → job", async ({ page }) => {
  test.skip(!process.env.E2E_LIVE, "set E2E_LIVE=1 with the API running");
  test.setTimeout(180_000);
  await page.unrouteAll();
  await page.goto("/");
  await page.getByLabel("Media URL").fill(process.env.E2E_LIVE_URL ?? "https://vimeo.com/1084537");
  await page.getByRole("button", { name: "Get formats" }).click();
  await expect(page).toHaveURL(/\/m\//, { timeout: 90_000 });
  await page.getByTestId("format-picker").getByRole("radio").first().click();
  await page.getByRole("button", { name: "Download" }).click();
  await expect(page.getByTestId("job-tray")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download file" })).toBeVisible({ timeout: 150_000 });
});
