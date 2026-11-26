import { expect, test } from "@playwright/test";
import { MOCK_USER_ME } from "../src/mocks/media";
import { alert, fail, mock, ok, stubSession } from "./helpers";

test.beforeEach(async ({ page }) => {
  await stubSession(page);
});

test("register shows field errors from a 422", async ({ page }) => {
  await mock(
    page,
    "POST",
    "/auth/register",
    fail(422, "UNPROCESSABLE", "Request validation failed", {
      details: [
        { path: "email", message: "Enter a valid email address" },
        { path: "password", message: "Password must be at least 10 characters" },
      ],
    }),
  );
  await page.goto("/register");
  await page.getByLabel("Email").fill("nope");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByText("Password must be at least 10 characters")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
});

test("degraded mode explains itself and points to what still works", async ({ page }) => {
  await mock(page, "POST", "/auth/login", fail(503, "DEGRADED", "db down"));
  await page.goto("/login");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(alert(page)).toContainText("Sign-in is paused for a moment");
  await expect(alert(page)).toContainText("as a guest");
});

test("a wrong password shows the server's message", async ({ page }) => {
  await mock(page, "POST", "/auth/login", fail(401, "UNAUTHORIZED", "That email and password don't match."));
  await page.goto("/login");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password").fill("wrong wrong wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(alert(page)).toContainText("don't match");
});

test("a successful sign-in lands on the home screen as that user", async ({ page }) => {
  let signedIn = false;
  await mock(page, "GET", "/auth/me", () => ok(signedIn ? MOCK_USER_ME : { ...MOCK_USER_ME, user: null, tier: "GUEST" }));
  await mock(page, "POST", "/auth/login", () => {
    signedIn = true;
    return ok(MOCK_USER_ME.user);
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Ada" })).toBeVisible();
});

test("writes echo the CSRF cookie in X-CSRF-Token", async ({ page, context }) => {
  await context.addCookies([{ name: "mg_csrf", value: "tok123", url: "http://localhost:3000" }]);
  let header: string | undefined;
  await mock(page, "POST", "/auth/login", (route) => {
    header = route.request().headers()["x-csrf-token"];
    return ok(MOCK_USER_ME.user);
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect.poll(() => header).toBe("tok123");
});
