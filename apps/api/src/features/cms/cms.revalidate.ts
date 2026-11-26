import { env } from '../../config/env.js';

/**
 * Tells the web app a CMS page or block changed so it re-renders on the next visit instead of waiting out the
 * 5-minute ISR window. Best-effort: a down web app must never fail a save, and it catches up on its own timer.
 */
export async function notifyWeb(target: { slug?: string; blockKey?: string }): Promise<void> {
  if (!env.WEB_INTERNAL_URL || !env.REVALIDATE_SECRET) return;
  try {
    await fetch(`${env.WEB_INTERNAL_URL.replace(/\/+$/, '')}/api/revalidate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revalidate-secret': env.REVALIDATE_SECRET },
      body: JSON.stringify(target),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    /* swallowed on purpose */
  }
}
