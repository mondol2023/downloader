import { DmcaForm } from "@/features/eligibility/components/DmcaForm";
import { CmsPageView, cmsMetadata } from "@/features/cms/render/CmsPageView";
import { getCmsPage } from "@/features/cms/render/server";

export const revalidate = 300;
export const generateMetadata = () => cmsMetadata("dmca", "DMCA");

export default async function Page() {
  // The notice form is the point of this page, so it still renders when the CMS copy is unavailable.
  const copy = await getCmsPage("dmca");
  return (
    <>
      {copy ? (
        <CmsPageView slug="dmca" />
      ) : (
        <main className="mx-auto w-full max-w-3xl px-4 pt-12">
          <h1 className="font-display text-4xl">DMCA and copyright notices</h1>
        </main>
      )}
      <div className="mx-auto w-full max-w-3xl px-4 pb-16">
        <DmcaForm />
      </div>
    </>
  );
}
