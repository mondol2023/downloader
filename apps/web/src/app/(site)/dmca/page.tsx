import { CmsPageView, cmsMetadata } from "@/features/cms/render/CmsPageView";

export const revalidate = 300;
export const generateMetadata = () => cmsMetadata("dmca", "DMCA");

export default function Page() {
  return <CmsPageView slug="dmca" />;
}
