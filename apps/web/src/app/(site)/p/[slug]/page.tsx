import { CmsPageView, cmsMetadata } from "@/features/cms/render/CmsPageView";

export const revalidate = 300;

export async function generateMetadata({ params }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  return cmsMetadata(slug, "Page");
}

export default async function Page({ params }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  return <CmsPageView slug={slug} />;
}
