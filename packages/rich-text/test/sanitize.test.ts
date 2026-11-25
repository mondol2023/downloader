import { describe, expect, it } from 'vitest';
import { sanitize } from '../src/sanitize';

const ORIGIN = 'https://cdn.example.com/cms';
const clean = (html: string) => sanitize(html, { assetOrigin: ORIGIN });

describe('sanitize: XSS fixtures are neutralised and the text survives', () => {
  it('drops onerror handlers and untrusted img sources', () => {
    const out = clean('<p>before<img src=x onerror=alert(1)>after</p>');
    expect(out).not.toMatch(/onerror|alert|<img/i);
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('removes javascript: hrefs but keeps the link text', () => {
    const out = clean('<a href="javascript:alert(1)">click me</a>');
    expect(out).not.toMatch(/javascript|href/i);
    expect(out).toContain('click me');
  });

  it('strips disallowed CSS (position, url()) but keeps the span text', () => {
    const out = clean('<span style="position:fixed;background:url(x)">hello</span>');
    expect(out).not.toMatch(/position|url\(|style/i);
    expect(out).toContain('hello');
  });

  it('drops iframes that are not YouTube-nocookie or Vimeo', () => {
    const out = clean('<p>video:</p><iframe src="https://evil.com"></iframe>');
    expect(out).not.toMatch(/iframe|evil/i);
    expect(out).toContain('video:');
  });

  it('removes svg and script payloads entirely', () => {
    const out = clean('<p>safe</p><svg><script>alert(1)</script></svg>');
    expect(out).not.toMatch(/svg|script|alert/i);
    expect(out).toContain('safe');
  });

  it('removes pasted MS Word mso-* styles, classes and conditional comments', () => {
    const out = clean(
      '<!--[if gte mso 9]><xml>x</xml><![endif]--><p class="MsoNormal" style="mso-margin-top-alt:auto;color:#112233">Word text</p>',
    );
    expect(out).not.toMatch(/mso|MsoNormal|xml|<!--/i);
    expect(out).toContain('Word text');
    expect(out).toContain('color:#112233');
  });

  it('refuses event-handler and data: / vbscript: variants', () => {
    const out = clean(
      '<a href="data:text/html;base64,AAAA" onclick="x()">a</a><a href="vbscript:x">b</a><a href=" jav&#x09;ascript:alert(1)">c</a>',
    );
    expect(out).not.toMatch(/data:|vbscript|onclick|javascript|jav/i);
    expect(out).toContain('a');
  });
});

describe('sanitize: links', () => {
  it('keeps https/http/mailto/# and forces rel on external links', () => {
    const out = clean(
      '<a href="https://a.com">x</a><a href="http://b.com" rel="opener">y</a><a href="mailto:a@b.co">z</a><a href="#top">w</a>',
    );
    expect(out).toContain('href="https://a.com"');
    expect(out).toContain('href="http://b.com"');
    expect(out).toContain('href="mailto:a@b.co"');
    expect(out).toContain('href="#top"');
    expect(out.match(/rel="noopener noreferrer nofollow"/g)).toHaveLength(2);
    expect(out).not.toContain('opener"');
  });

  it('drops relative and protocol-relative hrefs', () => {
    const out = clean('<a href="/admin">a</a><a href="//evil.com">b</a>');
    expect(out).not.toMatch(/href/);
  });
});

describe('sanitize: images', () => {
  it('keeps images served from the asset origin only', () => {
    const out = clean(
      `<img src="${ORIGIN}/a.webp" alt="ok"><img src="https://evil.com/a.png" alt="bad"><img src="${ORIGIN}.evil.com/a.png">`,
    );
    expect(out).toContain(`src="${ORIGIN}/a.webp"`);
    expect(out).not.toContain('evil.com');
  });

  it('drops every image when no asset origin is configured', () => {
    expect(sanitize('<img src="https://cdn.example.com/cms/a.webp">', { assetOrigin: '' })).toBe('');
  });
});

describe('sanitize: iframes', () => {
  it('allows YouTube nocookie and Vimeo player embeds', () => {
    const out = clean(
      '<iframe src="https://www.youtube-nocookie.com/embed/abc123"></iframe><iframe src="https://player.vimeo.com/video/123"></iframe>',
    );
    expect(out).toContain('youtube-nocookie.com/embed/abc123');
    expect(out).toContain('player.vimeo.com/video/123');
  });

  it('rejects look-alike hosts and non-embed paths', () => {
    const out = clean(
      '<iframe src="https://www.youtube-nocookie.com.evil.com/embed/a"></iframe><iframe src="https://www.youtube.com/embed/a"></iframe><iframe src="https://www.youtube-nocookie.com/watch?v=a"></iframe>',
    );
    expect(out).not.toMatch(/iframe/);
  });
});

describe('sanitize: styles and classes', () => {
  it('keeps the allowed style properties with valid values', () => {
    const out = clean(
      '<p style="text-align:center;line-height:1.6"><span style="color:#ff0000;background-color:rgb(1,2,3);font-size:24px;font-family:Fraunces, serif">t</span></p>',
    );
    expect(out).toContain('text-align:center');
    expect(out).toContain('line-height:1.6');
    expect(out).toContain('color:#ff0000');
    expect(out).toContain('background-color:rgb(1,2,3)');
    expect(out).toContain('font-size:24px');
    expect(out).toMatch(/font-family:Fraunces/);
  });

  it('rejects out-of-range or hostile values', () => {
    const out = clean(
      '<span style="font-size:9px;line-height:3;color:expression(alert(1));font-family:Comic Sans">a</span><span style="font-size:73px">b</span><span style="color:red">c</span>',
    );
    expect(out).not.toMatch(/font-size|line-height|color|font-family|expression/);
  });

  it('only keeps text-align-* and cms-* classes', () => {
    const out = clean('<p class="text-align-center cms-indent-2 evil MsoNormal">x</p>');
    expect(out).toContain('class="text-align-center cms-indent-2"');
  });
});

describe('sanitize: structure', () => {
  it('keeps tables, lists and disabled task-list checkboxes', () => {
    const out = clean(
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table><ul><li><label><input type="checkbox" checked><span></span></label><div><p>todo</p></div></li></ul>',
    );
    expect(out).toContain('<table>');
    expect(out).toContain('<th>h</th>');
    expect(out).toMatch(/<input[^>]*type="checkbox"/);
    expect(out).toMatch(/<input[^>]*disabled/);
  });

  it('drops non-checkbox inputs and forms', () => {
    const out = clean('<form action="/x"><input type="text" name="q"><button>go</button></form>');
    expect(out).not.toMatch(/form|input|button/);
  });
});
