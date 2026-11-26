import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { MOCK_ADMIN_ME, MOCK_GUEST_ME } from "../src/mocks/media";
import { fail, mock, ok, stubSession } from "./helpers";

// Same stand-in for the API's role check as admin-policy.spec.ts (the admin layout runs on the Next server).
const url = new URL(process.env.API_INTERNAL_URL ?? "http://localhost:4000");
let server: Server | null = null;
let busy = false;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    const me = /mg_test_role=admin/.test(req.headers.cookie ?? "") ? MOCK_ADMIN_ME : MOCK_GUEST_ME;
    res.end(JSON.stringify({ data: req.url?.startsWith("/api/v1/auth/me") ? me : [] }));
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

const takedown = (id: string, status: string) => ({
  id, mediaId: `yt:${id}`, sourceUrl: `https://www.youtube.com/watch?v=${id}`, reason: "claimed", status,
  requesterEmail: null, createdAt: "2026-11-20T10:00:00Z",
});

test.beforeEach(async ({ context, page }) => {
  test.skip(busy, "needs the stub API; a real API owns the port");
  await context.addCookies([{ name: "mg_test_role", value: "admin", url: `http://localhost:${process.env.E2E_PORT ?? 3000}` }]);
  await stubSession(page, MOCK_ADMIN_ME);
});

test("approving a takedown names the source and then sends the decision", async ({ page }) => {
  let status = "PENDING";
  let patched: unknown;
  await mock(page, "GET", "/admin/takedowns", () => ok({ items: [takedown("abc", status)], nextCursor: null }));
  await mock(page, "PATCH", "/admin/takedowns/abc", (route) => {
    patched = route.request().postDataJSON();
    status = "ACTIVE";
    return ok(takedown("abc", status));
  });

  await page.goto("/admin/takedowns");
  await page.getByRole("button", { name: "Approve" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("https://www.youtube.com/watch?v=abc");
  expect(patched).toBeUndefined(); // nothing is sent until confirmed
  await dialog.getByRole("button", { name: "Approve and block" }).click();
  await expect(dialog).toBeHidden();
  expect(patched).toEqual({ status: "ACTIVE" });
  await expect(page.getByTestId("row").getByText("ACTIVE")).toBeVisible();
});

test("a refused change keeps the dialog open and shows why", async ({ page }) => {
  const user = { id: "u1", email: "ada@example.com", displayName: null, tier: "FREE", role: "ADMIN", emailVerified: true, disabledAt: null, disabledReason: null, lastLoginAt: null, createdAt: "2026-11-01T00:00:00Z" };
  await mock(page, "GET", "/admin/users", ok({ items: [user], nextCursor: null }));
  await mock(page, "PATCH", "/admin/users/u1", fail(409, "CONFLICT", "You cannot disable the last admin"));

  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Disable ada@example.com" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("ada@example.com");
  await dialog.getByRole("button", { name: "Disable account" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("You cannot disable the last admin");
});

test("filters live in the URL and the next page uses the cursor", async ({ page }) => {
  const seen: string[] = [];
  const job = (id: string) => ({ id, userId: null, type: "DOWNLOAD", state: "FAILED", platform: "youtube", mediaTitle: `Job ${id}`, sourceUrl: null, formatLabel: "720p", tierAtRequest: "FREE", percent: null, stage: null, error: "boom", createdAt: "2026-11-20T10:00:00Z" });
  await mock(page, "GET", "/admin/jobs", (route) => {
    const u = new URL(route.request().url());
    seen.push(u.search);
    return ok(u.searchParams.get("cursor") ? { items: [job("j2")], nextCursor: null } : { items: [job("j1")], nextCursor: "j1" });
  });

  await page.goto("/admin/jobs?state=FAILED");
  await expect(page.getByText("Job j1")).toBeVisible();
  expect(seen[0]).toBe("?state=FAILED");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Job j2")).toBeVisible();
  await expect(page).toHaveURL(/cursor=j1/);
  expect(seen.at(-1)).toContain("cursor=j1");
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByText("Job j1")).toBeVisible();
  // Finished jobs offer no cancel action.
  await expect(page.getByRole("button", { name: /Cancel job/ })).toHaveCount(0);
});
