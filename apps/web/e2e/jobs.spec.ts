import { expect, test } from "@playwright/test";
import { mockJob } from "../src/mocks/media";
import { fail, mock, ok, stubSession } from "./helpers";

test.beforeEach(async ({ page }) => {
  await stubSession(page);
});

test("the list shows every state and cancel hits the API", async ({ page }) => {
  const states = ["queued", "extracting", "downloading", "processing", "completed", "failed", "cancelled"] as const;
  await mock(page, "GET", "/jobs", ok(states.map((s) => mockJob(s))));
  let cancelled = false;
  await mock(page, "POST", "/jobs/job-downloading/cancel", () => {
    cancelled = true;
    return ok(mockJob("cancelled", { id: "job-downloading" }));
  });
  await page.goto("/jobs");

  const cards = page.getByTestId("job-card");
  await expect(cards).toHaveCount(7);
  const downloading = page.locator('[data-state="downloading"]');
  await expect(downloading).toContainText("42%");
  await expect(downloading).toContainText("ETA 12s");
  await expect(downloading).toContainText("3.1 MB/s");
  await expect(page.locator('[data-state="completed"]').getByRole("link", { name: "Download file" })).toHaveAttribute("href", "/api/v1/jobs/job-completed/artifact");
  // A typed refusal reads as INELIGIBLE_COPY, not as a raw code.
  await expect(page.locator('[data-state="failed"]')).toContainText("This video is private");

  await downloading.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => cancelled).toBe(true);
});

test("an empty list invites a first download", async ({ page }) => {
  await page.goto("/jobs");
  await expect(page.getByText("No downloads yet")).toBeVisible();
});

test("the tray polls an active job every second and stops when it completes", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("media.trackedJobs", JSON.stringify(["job-9"])));
  let polls = 0;
  await mock(page, "GET", "/jobs/job-9", () => {
    polls += 1;
    return ok(polls < 3 ? mockJob("downloading", { id: "job-9" }) : mockJob("completed", { id: "job-9" }));
  });
  await page.goto("/");
  const tray = page.getByTestId("job-tray");
  await expect(tray.getByRole("link", { name: "Download file" })).toBeVisible({ timeout: 10_000 });

  const settled = polls;
  await page.waitForTimeout(2500);
  expect(polls).toBe(settled); // terminal state: polling has stopped

  await tray.getByRole("button", { name: "Dismiss" }).click();
  await expect(tray).toHaveCount(0);
});

test("the tray keeps a job through a server blip but drops one the server has forgotten", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("media.trackedJobs", JSON.stringify(["job-blip", "job-gone"])));
  await mock(page, "GET", "/jobs/job-blip", ok(mockJob("downloading", { id: "job-blip" })));
  let blips = 0;
  await mock(page, "GET", "/jobs/job-gone", () => fail(404, "NOT_FOUND", "gone"));
  await mock(page, "GET", "/jobs/job-blip", () => {
    blips += 1;
    return blips === 1 ? fail(502, "UPSTREAM_FAILED", "blip") : ok(mockJob("downloading", { id: "job-blip" }));
  });
  await page.goto("/jobs");
  await expect(page.getByTestId("job-tray").locator('[data-state="downloading"]')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => localStorage.getItem("media.trackedJobs"))).toBe('["job-blip"]');
});
