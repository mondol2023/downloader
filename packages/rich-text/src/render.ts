import { getSchema, type JSONContent } from '@tiptap/core';
import { DOMSerializer, Node as PmNode } from '@tiptap/pm/model';
import { createHTMLDocument } from 'zeed-dom';
import { extensions } from './extensions';
import { sanitize, type SanitizeOptions } from './sanitize';

const schema = getSchema(extensions);

/**
 * `@tiptap/html`'s generateHTML drops every inline `style` with the current prosemirror-model:
 * it assigns `dom.style.cssText`, which zeed-dom's read-only `style` object ignores. So colour,
 * size, alignment and line height would silently vanish. Same serialiser, but the document hands
 * out elements whose `style.cssText` writes through to the attribute.
 */
function createDocument() {
  const doc = createHTMLDocument();
  const createElement = doc.createElement.bind(doc);
  doc.createElement = ((tag: string) => {
    const el = createElement(tag);
    Object.defineProperty(el, 'style', {
      configurable: true,
      value: {
        set cssText(value: string) {
          el.setAttribute('style', value);
        },
      },
    });
    return el;
  }) as typeof doc.createElement;
  return doc;
}

/** Tiptap JSON → sanitised HTML. The only way stored HTML is produced. */
export function renderHtml(doc: JSONContent, options: SanitizeOptions = {}): string {
  const node = PmNode.fromJSON(schema, doc);
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(node.content, { document: createDocument() as never });
  return sanitize((fragment as unknown as { render(): string }).render(), options);
}
