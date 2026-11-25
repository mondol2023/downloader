import sanitizeHtml from 'sanitize-html';

/**
 * The one HTML allow-list. Everything the CMS stores or serves passes through `sanitize`, so the
 * public site never runs editor code and a hostile document can't smuggle script past the editor.
 */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;
const COLOUR = [HEX, RGB];

/** First family must be one of the 8 stacks; any fallbacks are restricted to plain family names. */
const FONT_FAMILY =
  /^["']?(?:Geist Sans|Fraunces|Geist Mono|-apple-system|system-ui|ui-sans-serif|ui-serif|Georgia|Inter|Arial)["']?(?:\s*,\s*["']?[A-Za-z0-9 _-]+["']?)*$/;

export const ALLOWED_STYLES: Record<string, RegExp[]> = {
  color: COLOUR,
  'background-color': COLOUR,
  'text-align': [/^(?:left|right|center|justify)$/],
  'font-family': [FONT_FAMILY],
  /** 10–72 px. */
  'font-size': [/^(?:[1-6]\d|7[0-2])px$/],
  /** 1.0–2.4, unitless. */
  'line-height': [/^(?:1(?:\.\d{1,2})?|2(?:\.[0-3]\d?)?|2\.4|2\.40?)$/],
};

export const ALLOWED_TAGS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'u', 's', 'sub', 'sup', 'mark', 'span', 'a',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'br', 'img', 'table', 'thead', 'tbody', 'tr', 'th',
  'td', 'colgroup', 'col', 'figure', 'figcaption', 'iframe', 'div', 'label', 'input',
];

export interface SanitizeOptions {
  /** Origin (and path prefix) images must be served from. Empty drops every image. Defaults to `CMS_ASSET_ORIGIN`. */
  assetOrigin?: string;
}

function isEmbedSrc(src: string | undefined): boolean {
  if (!src) return false;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (url.hostname === 'www.youtube-nocookie.com') return /^\/embed\/[\w-]{1,64}$/.test(url.pathname);
  if (url.hostname === 'player.vimeo.com') return /^\/video\/\d{1,20}$/.test(url.pathname);
  return false;
}

export function sanitize(html: string, options: SanitizeOptions = {}): string {
  const origin = (options.assetOrigin ?? process.env.CMS_ASSET_ORIGIN ?? '').replace(/\/+$/, '');

  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      '*': ['class', 'style'],
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      iframe: ['src', 'width', 'height', 'allowfullscreen', 'frameborder', 'title'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      input: ['type', 'checked', 'disabled'],
      ul: ['data-type'],
      li: ['data-type', 'data-checked'],
      div: ['data-youtube-video'],
    },
    allowedStyles: { '*': ALLOWED_STYLES },
    allowedClasses: { '*': ['text-align-*', 'cms-*'] },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedSchemesByTag: { img: ['https', 'http'], iframe: ['https'] },
    allowProtocolRelative: false,
    allowedIframeHostnames: ['www.youtube-nocookie.com', 'player.vimeo.com'],
    allowIframeRelativeUrls: false,
    transformTags: {
      a: (tagName, attribs) => {
        const href = (attribs.href ?? '').trim();
        const out: Record<string, string> = {};
        if (/^(?:https?:|mailto:)/i.test(href)) {
          out.href = href;
          if (/^https?:/i.test(href)) out.rel = 'noopener noreferrer nofollow';
          if (attribs.target === '_blank') {
            out.target = '_blank';
            out.rel = 'noopener noreferrer nofollow';
          }
        } else if (href.startsWith('#')) {
          out.href = href;
        }
        return { tagName, attribs: out };
      },
      img: (tagName, attribs) => {
        const src = (attribs.src ?? '').trim();
        const ok = origin !== '' && src.startsWith(`${origin}/`) && !src.includes('..');
        const { src: _src, ...rest } = attribs;
        return { tagName, attribs: ok ? { ...rest, src } : rest };
      },
      iframe: (tagName, attribs) => {
        const src = (attribs.src ?? '').trim();
        const { src: _src, ...rest } = attribs;
        return { tagName, attribs: isEmbedSrc(src) ? { ...rest, src } : rest };
      },
      input: (tagName, attribs) => {
        if (attribs.type !== 'checkbox') return { tagName, attribs: {} };
        return {
          tagName,
          attribs: { type: 'checkbox', disabled: 'disabled', ...(attribs.checked !== undefined ? { checked: 'checked' } : {}) },
        };
      },
    },
    exclusiveFilter: (frame) => {
      if (frame.tag === 'img' || frame.tag === 'iframe') return !frame.attribs.src;
      if (frame.tag === 'input') return frame.attribs.type !== 'checkbox';
      return false;
    },
  });
}
