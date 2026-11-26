import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { MOCK_ADMIN_ME, MOCK_ADMIN_STATS, MOCK_GUEST_ME, MOCK_USER_ME } from "../src/mocks/media";

// The admin layout checks the role on the Next *server*, which page.route can't intercept,
// so stand in for the API itself (the rewrite target) and pick the identity from a cookie.
const url = new URL(process.env.API_INTERNAL_URL ?? "http://localhost:4000");
let server: Server | null = null;
let busy = false;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const who = /mg_test_role=(\w+)/.exec(req.headers.cookie ?? "")?.[1];
    const me = who === "admin" ? MOCK_ADMIN_ME : who === "user" ? MOCK_USER_ME : MOCK_GUEST_ME;
    const path = req.url?.split("?")[0];
    res.setHeader("content-type", "application/json");
    if (path === "/api/v1/auth/me") return void res.end(JSON.stringify({ data: me }));
    if (path === "/api/v1/admin/stats") return void res.end(JSON.stringify({ data: MOCK_ADMIN_STATS }));
    res.statusCode = 200;
    res.end(JSON.stringify({ data: [] }));
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

const as = (role: string) => ({ name: "mg_test_role", value: role, url: `http://localhost:${process.env.E2E_PORT ?? 3000}` });

test("a signed-out visitor is redirected to /login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
});

test("a USER is redirected to /login", async ({ page, context }) => {
  test.skip(busy, "needs the stub API; a real API owns the port");
  await context.addCookies([as("user")]);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
});

test("an ADMIN sees the sidebar and dashboard", async ({ page, context }) => {
  test.skip(busy, "needs the stub API; a real API owns the port");
  await context.addCookies([as("admin")]);
  await page.goto("/admin");
  const nav = page.getByRole("navigation", { name: "Admin" });
  for (const label of ["Dashboard", "Restrictions", "Sites", "Tiers", "Takedowns", "Users", "Jobs", "Audit", "Content"]) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }
  await expect(page.getByTestId("stat-tile")).toHaveCount(4);
  await expect(page.getByText("SOURCE_PRIVATE")).toBeVisible();
});
