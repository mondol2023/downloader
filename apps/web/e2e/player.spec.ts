import { expect, test } from "@playwright/test";
import { MOCK_GRANT, mockExtract } from "../src/mocks/media";
import { alert, fail, mock, ok, stubSession } from "./helpers";

test.beforeEach(async ({ page }) => {
  await stubSession(page);
  await mock(page, "GET", "/media/mock-media", ok(mockExtract()));
});

test("poster → loading → playing, with a subtitle selector", async ({ page }) => {
  let sent: unknown;
  await mock(page, "POST", "/media/playback", async (route) => {
    sent = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 200));
    return ok(MOCK_GRANT);
  });
  await page.route("**/api/stream/**", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/api/v1/media/mock-media/subtitles/*", (route) =>
    route.fulfill({ contentType: "text/vtt", body: "WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n" }),
  );
  await page.goto("/m/mock-media");

  const player = page.getByTestId("player");
  await expect(player).toHaveAttribute("data-phase", "poster");
  await page.getByRole("button", { name: /^Play / }).click();
  await expect(player).toHaveAttribute("data-phase", "loading");
  await expect(player.locator("video")).toBeVisible();
  expect(sent).toEqual({ url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", formatId: "22" });

  await expect(player.locator("track")).toHaveCount(2);
  await player.getByLabel("Subtitles").selectOption("en");
  await expect(player.getByLabel("Subtitles")).toHaveValue("en");
});

test("playback not on the plan shows an upsell and leaves downloading available", async ({ page }) => {
  await mock(page, "POST", "/media/playback", fail(403, "FORBIDDEN", "no", { requiredTier: "FREE" }));
  await page.goto("/m/mock-media");
  await page.getByRole("button", { name: /^Play / }).click();
  await expect(page.getByTestId("player")).toHaveAttribute("data-phase", "error");
  await expect(alert(page)).toContainText("In-app playback isn't on your plan");
  await expect(page.getByRole("button", { name: "Download" })).toBeEnabled();
});

test("a video-only pick still previews the best muxed format", async ({ page }) => {
  const formats = mockExtract().formats.map((f) => (f.id === "401" ? { ...f, allowed: true, lockReason: null } : f));
  await mock(page, "GET", "/media/mock-media", ok(mockExtract({ formats })));
  let sent: { formatId?: string } = {};
  await mock(page, "POST", "/media/playback", (route) => {
    sent = route.request().postDataJSON();
    return ok(MOCK_GRANT);
  });
  await page.goto("/m/mock-media");
  await page.getByTestId("format-picker").locator('[data-format-id="401"]').click();
  await page.getByRole("button", { name: /^Play / }).click();
  await expect(page.getByTestId("player").locator("video")).toBeVisible();
  expect(sent.formatId).toBe("22");
});
