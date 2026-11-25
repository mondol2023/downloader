import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { renderHtml } from '../src/render';

const ORIGIN = 'https://cdn.example.com/cms';
const opts = { assetOrigin: ORIGIN };

const mark = (type: string, text: string, attrs?: Record<string, unknown>) => ({
  type: 'text',
  text,
  marks: [{ type, ...(attrs ? { attrs } : {}) }],
});

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

const doc: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
    { type: 'heading', attrs: { level: 6 }, content: [{ type: 'text', text: 'Small' }] },
    {
      type: 'paragraph',
      attrs: { textAlign: 'center', lineHeight: '1.6', indent: 2 },
      content: [
        mark('bold', 'b'),
        mark('italic', 'i'),
        mark('underline', 'u'),
        mark('strike', 's'),
        mark('code', 'c'),
        mark('subscript', 'sub'),
        mark('superscript', 'sup'),
        mark('link', 'link', { href: 'https://example.com', target: '_blank' }),
        mark('highlight', 'hl', { color: '#ffff00' }),
        mark('textStyle', 'styled', { color: '#cc0000', fontSize: '24px', fontFamily: 'Fraunces, serif' }),
      ],
    },
    { type: 'blockquote', content: [para('quote')] },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const a = 1' }] },
    { type: 'horizontalRule' },
    { type: 'bulletList', content: [{ type: 'listItem', content: [para('one')] }] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [para('two')] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [para('done')] }] },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [para('H')] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [para('C')] }] },
      ],
    },
    { type: 'image', attrs: { src: `${ORIGIN}/a.webp`, alt: 'An image', title: 'cap' } },
    { type: 'youtube', attrs: { src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } },
  ],
};

describe('renderHtml', () => {
  const html = renderHtml(doc, opts);

  it('keeps every node type', () => {
    for (const re of [
      /<h1[ >]/, /<h6[ >]/, /<blockquote/, /<pre><code/, /<hr/, /<ul/, /<ol/, /<table/, /<th/, /<td/,
      /<input[^>]*checkbox/, /<img[^>]*a\.webp/, /<iframe[^>]*youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/,
    ]) {
      expect(html).toMatch(re);
    }
  });

  it('keeps every mark', () => {
    for (const re of [/<strong>b/, /<em>i/, /<u>u/, /<s>s/, /<code>c/, /<sub>sub/, /<sup>sup/, /<a [^>]*href="https:\/\/example\.com"/, /<mark[^>]*>hl/]) {
      expect(html).toMatch(re);
    }
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it('keeps every allowed style', () => {
    expect(html).toContain('text-align:center');
    expect(html).toContain('line-height:1.6');
    expect(html).toContain('color:#cc0000');
    expect(html).toContain('font-size:24px');
    expect(html).toMatch(/font-family:Fraunces/);
    expect(html).toMatch(/background-color:#ffff00/);
    expect(html).toContain('cms-indent-2');
  });

  it('sanitises hostile documents instead of trusting the editor', () => {
    const evil: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [mark('link', 'x', { href: 'javascript:alert(1)' })] },
        { type: 'image', attrs: { src: 'https://evil.com/x.png' } },
      ],
    };
    const out = renderHtml(evil, opts);
    expect(out).not.toMatch(/javascript|evil|<img/i);
    expect(out).toContain('x');
  });
});
