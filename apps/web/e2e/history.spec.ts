import { expect, test } from "@playwright/test";
import { MOCK_QUOTA, MOCK_USER_ME, mockJob } from "../src/mocks/media";
import { mock, ok, stubSession } from "./helpers";

test("shows the quota meter with its reset time and the job history", async ({ page }) => {
  await stubSession(page, MOCK_USER_ME);
  await mock(page, "GET", "/jobs", ok([mockJob("completed"), mockJob("failed")]));
  await page.goto("/account/history");
  const meter = page.getByTestId("quota-meter");
  await expect(meter).toContainText("4");
  await expect(meter).toContainText("/ 10");
  await expect(meter).toContainText("frees up");
  await expect(page.getByTestId("job-card")).toHaveCount(2);
});

test("a full quota says when it frees up and offers plans", async ({ page }) => {
  await stubSession(page, { ...MOCK_USER_ME, quota: { ...MOCK_QUOTA, downloadsUsed: 3 } });
  await page.goto("/account/history");
  await expect(page.getByTestId("quota-meter")).toContainText("You've used today's downloads");
  await expect(page.getByRole("link", { name: "Need more? See plans" })).toBeVisible();
});

test("unlimited plans have no meter bar", async ({ page }) => {
  const quota = { ...MOCK_QUOTA, tier: "PRO" as const, downloadsLimit: null, downloadsUsed: 42 };
  await stubSession(page, { ...MOCK_USER_ME, tier: "PRO", quota: quota as never });
  await page.goto("/account/history");
  await expect(page.getByTestId("quota-meter")).toContainText("Unlimited");
  await expect(page.getByTestId("quota-meter").getByRole("progressbar")).toHaveCount(0);
});

test("guests are told their history is per-browser", async ({ page }) => {
  await stubSession(page);
  await page.goto("/account/history");
  await expect(page.getByText("only covers this browser")).toBeVisible();
});
