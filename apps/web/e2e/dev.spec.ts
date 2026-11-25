import { expect, test } from "@playwright/test";
import { stubSession } from "./helpers";

// The /dev/<feature> galleries render every state on mock data; they must never crash.
for (const feature of ["extract", "formats", "player", "jobs", "auth", "billing", "history", "admin", "tokens"]) {
  test(`/dev/${feature} renders without errors`, async ({ page }) => {
    await stubSession(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const res = await page.goto(`/dev/${feature}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("unknown dev gallery is a 404", async ({ page }) => {
  const res = await page.goto("/dev/nope");
  expect(res?.status()).toBe(404);
});
