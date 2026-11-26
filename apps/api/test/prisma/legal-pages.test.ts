import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/env.js', () => ({ env: { API_PUBLIC_URL: 'http://api.test', CMS_ASSET_ORIGIN: undefined } }));

import { LEGAL_PAGES, seedLegalPages } from '../../prisma/legal-pages.js';
import { renderDoc } from '../../src/features/cms/cms.render.js';

describe('seeded legal pages', () => {
  it('cover terms, privacy and dmca and render to clean HTML', () => {
    expect(LEGAL_PAGES.map((p) => p.slug)).toEqual(['terms', 'privacy', 'dmca']);
    for (const page of LEGAL_PAGES) {
      const html = renderDoc(page.contentJson);
      expect(html).toContain('<h2');
      expect(html).not.toMatch(/<script|onerror/i);
    }
    expect(renderDoc(LEGAL_PAGES[0].contentJson)).toMatch(/right to download/i);
  });

  it('creates missing pages as PUBLISHED and never overwrites an existing one', async () => {
    const created: string[] = [];
    const prisma = {
      cmsPage: {
        findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => (where.slug === 'privacy' ? { id: 'x' } : null)),
        create: vi.fn(async ({ data }: { data: { slug: string; status: string } }) => {
          created.push(`${data.slug}:${data.status}`);
        }),
      },
    };
    expect(await seedLegalPages(prisma as never, 'u1')).toBe(2);
    expect(created).toEqual(['terms:PUBLISHED', 'dmca:PUBLISHED']);
  });
});
