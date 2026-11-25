import { expect, test } from "@playwright/test";
import { mockExtract, mockJob } from "../src/mocks/media";
import { alert, fail, mock, ok, stubSession } from "./helpers";

test.beforeEach(async ({ page }) => {
  await stubSession(page);
});

test("groups formats, preselects the recommendation, and locks the rest with an upsell", async ({ page }) => {
  await mock(page, "GET", "/media/mock-media", ok(mockExtract()));
  await page.goto("/m/mock-media");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Big Buck Bunny");
  const picker = page.getByTestId("format-picker");
  await expect(picker.getByRole("heading", { name: "Video" })).toBeVisible();
  await expect(picker.getByRole("heading", { name: "Audio only" })).toBeVisible();
  await expect(picker.getByRole("heading", { name: "Subtitles" })).toBeVisible();

  // recommendedFormatId (720p) is preselected; locked keys are marked, not hidden.
  await expect(picker.locator('[data-format-id="22"]')).toHaveAttribute("aria-checked", "true");
  await expect(picker.locator('[data-locked]')).toHaveCount(2);
  await expect(page.getByTestId("locked-banner")).toContainText("2 higher-quality formats");

  // aria-disabled keys stay clickable on purpose (they explain themselves); Playwright treats them as disabled.
  await picker.locator('[data-format-id="401"]').click({ force: true });
  const upsell = page.getByTestId("upsell");
  await expect(upsell).toContainText("above your plan limit");
  await expect(upsell.getByRole("link")).toHaveText("Upgrade to Pro for 2160p");
  await expect(picker.locator('[data-format-id="22"]')).toHaveAttribute("aria-checked", "true");
});

test("audio-only picks offer a conversion choice, and Download enqueues the chosen format", async ({ page }) => {
  await mock(page, "GET", "/media/mock-media", ok(mockExtract()));
  let body: unknown;
  await mock(page, "POST", "/jobs", (route) => {
    body = route.request().postDataJSON();
    return ok(mockJob("queued", { id: "job-1" }), 202);
  });
  await mock(page, "GET", "/jobs/job-1", ok(mockJob("downloading", { id: "job-1" })));
  await page.goto("/m/mock-media");

  await page.getByTestId("format-picker").locator('[data-format-id="140"]').click();
  await expect(page.getByLabel("Audio format")).toBeVisible();
  await page.getByRole("button", { name: "Download" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Added to your downloads" })).toBeVisible();
  expect(body).toEqual({ url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", formatId: "140" });
  await expect(page.getByTestId("job-tray")).toBeVisible();
});

test("a quota refusal explains what to do next", async ({ page }) => {
  await mock(page, "GET", "/media/mock-media", ok(mockExtract()));
  await mock(page, "POST", "/jobs", fail(429, "TOO_MANY_REQUESTS", "limit", { retryAfterSeconds: 60 }));
  await page.goto("/m/mock-media");
  await page.getByRole("button", { name: "Download" }).click();
  await expect(alert(page)).toContainText("used all of today's downloads");
  await expect(alert(page).getByRole("link", { name: "See plans" })).toBeVisible();
});

test("an expired result sends people back to paste the link again", async ({ page }) => {
  await mock(page, "GET", "/media/gone", fail(404, "NOT_FOUND", "not cached"));
  await page.goto("/m/gone");
  await expect(page.getByRole("heading", { name: "That link has expired" })).toBeVisible();
});

test("a signed-in Pro viewer sees no locked formats", async ({ page }) => {
  const formats = mockExtract().formats.map((f) => ({ ...f, allowed: true, lockReason: null }));
  await mock(page, "GET", "/media/mock-media", ok(mockExtract({ formats, lockedFormatCount: 0, tier: "PRO" })));
  await page.goto("/m/mock-media");
  await expect(page.getByTestId("format-picker")).toBeVisible();
  await expect(page.locator("[data-locked]")).toHaveCount(0);
  await expect(page.getByTestId("locked-banner")).toHaveCount(0);
});
