import { INELIGIBLE_CODES, type IneligibleCode } from "@media/shared";

export const isRefusalCode = (code: string): code is IneligibleCode =>
  (INELIGIBLE_CODES as readonly string[]).includes(code);

/** What the person *can* do next. Titles and bodies come verbatim from INELIGIBLE_COPY. */
export const NEXT_STEP: Record<IneligibleCode, string> = {
  SOURCE_PRIVATE: "Try a public link, or an unlisted one that anyone with the URL can open.",
  SOURCE_MEMBERS_ONLY: "Try a link that anyone can watch without paying or joining.",
  SOURCE_NEEDS_LOGIN: "Try a link that opens without signing in.",
  SOURCE_DRM: "Try a video from a site that serves it openly, such as a public upload.",
  SOURCE_AGE_RESTRICTED: "Try another public link that doesn't need an age check.",
  SOURCE_LIVE: "Come back after the stream ends, or paste a link to a finished recording.",
  SOURCE_BLOCKED_DOMAIN: "Try a link from another site.",
  SOURCE_GEOBLOCKED: "Try a link that's open worldwide.",
  SOURCE_PLATFORM_DISABLED: "Try again in a little while, or paste a link from another site.",
};

/** Syntactic check only; the server is the authority on whether the source is downloadable. */
export function parseMediaUrl(raw: string): URL | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) return null;
    return url;
  } catch {
    return null;
  }
}

export const platformLabel = (url: URL) => url.hostname.replace(/^(www|m)\./, "");
