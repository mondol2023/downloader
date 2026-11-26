import { expect, test } from "@playwright/test";
import { fail, mock, ok, stubSession } from "./helpers";

test.beforeEach(async ({ page }) => {
  await stubSession(page);
});

test("the DMCA page files a notice for review", async ({ page }) => {
  let body: unknown;
  await mock(page, "POST", "/takedowns", (route) => {
    body = route.request().postDataJSON();
    return ok({ received: true }, 202);
  });
  await page.goto("/dmca");
  const form = page.getByTestId("dmca-form");
  await expect(form.getByRole("button", { name: "Send notice" })).toBeDisabled();

  await form.getByLabel("Link to the content").fill("https://www.youtube.com/watch?v=abc123");
  await form.getByLabel("Your name").fill("Ada Rights");
  await form.getByLabel("Your email").fill("ada@example.com");
  await form.getByLabel(/The work and your right/).fill("I am the copyright owner and did not license this.");
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: "Send notice" }).click();

  await expect(page.getByTestId("dmca-done")).toContainText("received your notice");
  expect(body).toMatchObject({ requesterEmail: "ada@example.com", goodFaith: true });
});

test("a refused notice shows the reason and keeps the form", async ({ page }) => {
  await mock(page, "POST", "/takedowns", fail(400, "BAD_REQUEST", "That host is not reachable from this service"));
  await page.goto("/dmca");
  const form = page.getByTestId("dmca-form");
  await form.getByLabel("Link to the content").fill("http://169.254.169.254/x");
  await form.getByLabel("Your name").fill("Ada");
  await form.getByLabel("Your email").fill("ada@example.com");
  await form.getByLabel(/The work and your right/).fill("I am the copyright owner and did not license this.");
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: "Send notice" }).click();
  await expect(form.getByRole("alert")).toContainText("not reachable");
});
