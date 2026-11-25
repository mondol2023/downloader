/** Why a source can't be downloaded. Shared so the API and the web app agree on codes and wording. */
export const INELIGIBLE_CODES = [
  'SOURCE_PRIVATE',
  'SOURCE_MEMBERS_ONLY',
  'SOURCE_NEEDS_LOGIN',
  'SOURCE_DRM',
  'SOURCE_AGE_RESTRICTED',
  'SOURCE_LIVE',
  'SOURCE_BLOCKED_DOMAIN',
  'SOURCE_GEOBLOCKED',
  'SOURCE_PLATFORM_DISABLED',
  'SOURCE_TAKEN_DOWN',
] as const;

export type IneligibleCode = (typeof INELIGIBLE_CODES)[number];

export const INELIGIBLE_COPY: Record<IneligibleCode, { title: string; body: string }> = {
  SOURCE_PRIVATE: {
    title: 'This video is private',
    body: "The owner has restricted it, so we can't access it.",
  },
  SOURCE_MEMBERS_ONLY: {
    title: 'Members-only or paid content',
    body: "This is behind a membership, subscription or paywall, and we don't download paid content.",
  },
  SOURCE_NEEDS_LOGIN: {
    title: 'Sign-in required',
    body: "The site only shows this to signed-in viewers, and we never sign in on your behalf.",
  },
  SOURCE_DRM: {
    title: 'Copy-protected content',
    body: "This is protected by DRM. We don't download copy-protected media.",
  },
  SOURCE_AGE_RESTRICTED: {
    title: 'Age-restricted content',
    body: "The site requires a signed-in, age-verified account to view this, so we can't fetch it.",
  },
  SOURCE_LIVE: {
    title: "This is a live or upcoming stream",
    body: 'Live streams have no fixed size. Try again once the broadcast has ended and the recording is available.',
  },
  SOURCE_BLOCKED_DOMAIN: {
    title: "We can't download from this site",
    body: 'Everything on this site is copy-protected, so downloads are not supported.',
  },
  SOURCE_GEOBLOCKED: {
    title: "This video isn't available in your region",
    body: 'The uploader or rights-holder restricts it.',
  },
  SOURCE_PLATFORM_DISABLED: {
    title: 'This site is currently unavailable',
    body: 'Downloads from this site are switched off right now. Please try again later.',
  },
  SOURCE_TAKEN_DOWN: {
    title: 'This media is no longer available',
    body: "It was removed following a takedown request, so we can't download it.",
  },
};
