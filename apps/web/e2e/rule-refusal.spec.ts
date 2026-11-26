import { expect, test } from "@playwright/test";
import { INELIGIBLE_COPY } from "@media/shared";
import { fail, mock, stubSession } from "./helpers";

test.beforeEach(async ({ page }) => {
  await stubSession(page);
});

test("a rule refusal shows the rule's own message instead of the stock body", async ({ page }) => {
  await mock(page, "POST", "/media/extract", fail(403, "SOURCE_RULE_BLOCKED", "Shorts are not supported here."));
  await page.goto("/");
  await page.getByLabel("Media URL").fill("https://www.youtube.com/shorts/abc123");
  await page.getByRole("button", { name: "Get formats" }).click();
  const refusal = page.getByTestId("refusal");
  await expect(refusal).toHaveAttribute("data-code", "SOURCE_RULE_BLOCKED");
  await expect(refusal).toContainText(INELIGIBLE_COPY.SOURCE_RULE_BLOCKED.title);
  await expect(refusal).toContainText("Shorts are not supported here.");
  await expect(refusal).not.toContainText(INELIGIBLE_COPY.SOURCE_RULE_BLOCKED.body);
});
