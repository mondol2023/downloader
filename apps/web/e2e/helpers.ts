import type { Page, Route } from "@playwright/test";
import { MOCK_GUEST_ME, MOCK_QUOTA } from "../src/mocks/media";
import type { MeResponse } from "../src/lib/types";

export const ok = (data: unknown, status = 200) => ({ status, json: { data } });
export const fail = (status: number, code: string, message: string, extra: object = {}) => ({
  status,
  json: { error: { code, message, ...extra } },
});

type Reply = ReturnType<typeof ok> | ReturnType<typeof fail>;
export type Handler = Reply | ((route: Route) => Reply | Promise<Reply>);

/** Intercepts `/api/v1<path>` (exact path, any query). Later registrations win. */
export async function mock(page: Page, method: string, path: string, handler: Handler) {
  await page.route(
    (url) => url.pathname === `/api/v1${path}`,
    async (route) => {
      if (route.request().method() !== method) return route.fallback();
      const reply = typeof handler === "function" ? await handler(route) : handler;
      return route.fulfill(reply);
    },
  );
}

/** Every page asks who the viewer is; default to a guest. Also stubs the quota and jobs list. */
export async function stubSession(page: Page, me: MeResponse = MOCK_GUEST_ME) {
  await mock(page, "GET", "/auth/me", ok(me));
  await mock(page, "GET", "/jobs/quota", ok(me.quota ?? MOCK_QUOTA));
  await mock(page, "GET", "/jobs", ok([]));
}

/** First download on a device asks people to confirm they have the rights; tick it once. */
export async function confirmRights(page: Page) {
  await page.getByLabel(/I own this content or have the right to download it/).check();
}

/** App alerts only: Next's route announcer is also role=alert. */
export const alert = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');
