import { expect, test } from "@playwright/test";
import { mockExtract } from "../src/mocks/media";
import { mock, ok, stubSession } from "./helpers";

/** Plan 7.4: with reduced motion on, nothing travels or scales; content still fades in fast. */
test.use({ reducedMotion: "reduce" });

test("reduced motion: input deck never transforms, result card is opaque within 200 ms", async ({ page }) => {
  await stubSession(page);
  await mock(page, "POST", "/media/extract", async () => {
    await new Promise((r) => setTimeout(r, 200));
    return ok(mockExtract());
  });
  await mock(page, "GET", "/media/mock-media", ok(mockExtract()));

  // Sample the deck's computed transform on every frame, from before the first keystroke.
  await page.addInitScript(() => {
    const w = window as unknown as { __deck: Set<string> };
    w.__deck = new Set();
    const loop = () => {
      const deck = document.querySelector("form[data-status]");
      if (deck) w.__deck.add(getComputedStyle(deck).transform);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    const c = ((window as unknown as { __card: object }).__card = { first: 0, opaque: 0, firstOpacity: -1 }) as { first: number; opaque: number; firstOpacity: number };
    const watch = () => {
      const card = document.querySelector('[data-testid="result-card"]');
      if (card) {
        const opacity = Number(getComputedStyle(card).opacity);
        if (!c.first) {
          c.first = performance.now();
          c.firstOpacity = opacity;
        }
        if (!c.opaque && opacity >= 0.999) c.opaque = performance.now();
      }
      if (!c.opaque) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });

  await page.goto("/");
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);

  const deck = page.locator("form[data-status]");
  await expect(deck).toHaveAttribute("data-status", "idle");
  await page.getByLabel("Media URL").fill("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
  await expect(deck).toHaveAttribute("data-seated", "true");
  await expect(page.getByTestId("platform-chip")).toHaveText("youtube.com");
  await page.waitForTimeout(500); // outlast the 0.98 -> 1 settle spring, which would show up as a matrix()
  await expect.poll(() => deck.evaluate((el) => getComputedStyle(el).transform)).toBe("none");

  await page.getByRole("button", { name: "Get formats" }).click();
  await expect(page).toHaveURL(/\/m\/mock-media$/);

  // Measured in-page from the card's first frame, so the check can't start after the fade is over.
  await expect(page.getByTestId("result-card")).toBeVisible();
  const settled = await page.evaluate(() => (window as unknown as { __card: { first: number; opaque: number; firstOpacity: number } }).__card);
  const ms = settled.opaque - settled.first;
  console.log(`7.4 reduced motion: result card first frame opacity ${settled.firstOpacity}, opaque after ${ms.toFixed(0)} ms`);
  expect(settled.opaque, "card never reached opacity 1").toBeGreaterThan(0);
  // 200 ms budget plus one 60 Hz frame of measurement slack.
  expect(ms).toBeLessThanOrEqual(220);

  const transforms = await page.evaluate(() => [...(window as unknown as { __deck: Set<string> }).__deck]);
  expect(transforms.length).toBeGreaterThan(0);
  expect(transforms, `deck transforms seen across the whole run: ${transforms.join(" | ")}`).toEqual(["none"]);
});
