import { notFound } from "next/navigation";
import { CmsContent } from "./CmsContent";
import { getCmsPage } from "./server";

export async function CmsPageView({ slug }: { slug: string }) {
  const page = await getCmsPage(slug);
  if (!page) notFound();
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <h1 className="font-display text-4xl">{page.title}</h1>
      <p className="mt-2 text-sm text-muted">
        Updated <time dateTime={page.updatedAt}>{new Date(page.updatedAt).toLocaleDateString("en", { dateStyle: "long" })}</time>
      </p>
      <CmsContent html={page.html} className="mt-8" />
    </main>
  );
}

export async function cmsMetadata(slug: string, fallbackTitle: string) {
  const page = await getCmsPage(slug);
  if (!page) return { title: `${fallbackTitle} · Media` };
  return {
    title: `${page.seo.title || page.title} · Media`,
    description: page.seo.description ?? undefined,
  };
}
