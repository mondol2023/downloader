import type { PrismaClient } from '@prisma/client';
import { renderDoc } from '../src/features/cms/cms.render.js';

/**
 * Starter copy for the three legal pages. It is DRAFT TEXT: have counsel review and replace it
 * (Admin → Pages) before launch. Seeding never overwrites a page an admin has already edited.
 */

type Node = Record<string, unknown>;
const text = (t: string): Node => ({ type: 'text', text: t });
const p = (t: string): Node => ({ type: 'paragraph', content: [text(t)] });
const h2 = (t: string): Node => ({ type: 'heading', attrs: { level: 2 }, content: [text(t)] });
const ul = (items: string[]): Node => ({
  type: 'bulletList',
  content: items.map((i) => ({ type: 'listItem', content: [p(i)] })),
});
const doc = (...content: Node[]) => ({ type: 'doc', content });

export const LEGAL_PAGES = [
  {
    slug: 'terms',
    title: 'Terms of Service',
    seoDescription: 'The rules for using this service, including what you may download.',
    contentJson: doc(
      p('These terms govern your use of this service. By using it you agree to them.'),
      h2('What you may download'),
      p('You may download only content that you own, that is in the public domain or under a licence that allows it, or that you otherwise have the right to download. You are responsible for checking that you have those rights before you download.'),
      h2('What you may not do'),
      ul([
        'Use the service to infringe anyone’s copyright or other rights.',
        'Circumvent technical protection measures, rate limits or access controls.',
        'Resell, redistribute or automate bulk use of the service.',
        'Attempt to reach private networks or internal systems through the service.',
      ]),
      h2('Takedowns'),
      p('We respond to notices of claimed infringement. Rights holders can submit one on the DMCA page. We may block a source, remove access to content and suspend accounts that repeatedly infringe.'),
      h2('Accounts and plans'),
      p('Free and paid plans have different daily limits. We may change limits, suspend accounts that break these terms, and change or end the service.'),
      h2('No warranty'),
      p('The service is provided as is. To the extent the law allows, we are not liable for losses arising from its use.'),
      h2('Contact'),
      p('Questions about these terms can be sent through the contact details published on this site.'),
    ),
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    seoDescription: 'What data this service collects, why, and how long it is kept.',
    contentJson: doc(
      p('This policy explains what we collect when you use the service and what we do with it.'),
      h2('What we collect'),
      ul([
        'Account data: your email address, display name and a hashed password.',
        'Usage data: the links you submit, the downloads you start and their outcome, used to enforce plan limits and to run the service.',
        'Technical data: a one-way hash of your IP address and basic request logs, used for abuse prevention and rate limiting.',
        'Takedown notices: the details a rights holder submits so we can assess the notice.',
      ]),
      h2('Why we use it'),
      p('To operate the service, apply daily limits, prevent abuse, respond to takedown notices and meet legal obligations. We do not sell personal data.'),
      h2('Cookies'),
      p('We use a session cookie to keep you signed in and a small amount of local storage to remember your preferences, such as having confirmed the rights statement before downloading.'),
      h2('Retention'),
      p('Downloaded files are temporary and are deleted automatically. Account and audit records are kept as long as needed for the purposes above.'),
      h2('Your choices'),
      p('You can ask us to access, correct or delete your account data through the contact details published on this site.'),
    ),
  },
  {
    slug: 'dmca',
    title: 'DMCA and copyright notices',
    seoDescription: 'Report content you believe infringes your copyright.',
    contentJson: doc(
      p('We respect the rights of copyright owners. If you believe content reachable through this service infringes your copyright, send us a notice using the form below.'),
      h2('What to include'),
      ul([
        'The link to the content you say is infringing.',
        'Your name and a working email address so we can reach you.',
        'A description of the work and why you are entitled to act for its owner.',
        'A statement that you are acting in good faith.',
      ]),
      p('We review each notice. A source named in an approved notice is blocked from further downloads. Knowingly sending a false notice may have legal consequences.'),
    ),
  },
] as const;

export async function seedLegalPages(prisma: PrismaClient, updatedById: string): Promise<number> {
  let created = 0;
  for (const page of LEGAL_PAGES) {
    const exists = await prisma.cmsPage.findUnique({ where: { slug: page.slug }, select: { id: true } });
    if (exists) continue;
    await prisma.cmsPage.create({
      data: {
        slug: page.slug,
        title: page.title,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        contentJson: page.contentJson as never,
        contentHtml: renderDoc(page.contentJson),
        seoTitle: page.title,
        seoDescription: page.seoDescription,
        updatedById,
      },
    });
    created += 1;
  }
  return created;
}
