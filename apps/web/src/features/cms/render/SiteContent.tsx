import "./cms.css";
import type { ReactNode } from "react";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { CmsOverridesProvider } from "./overrides";
import { BANNER_KEY, REFUSAL_KEYS, refusalOverrides } from "./refusal";
import { getCmsBlocks } from "./server";

/** Global CMS blocks for the layout: the announcement banner above the header, refusal copy overrides below. */
export async function SiteContent({ header, children }: { header: ReactNode; children: ReactNode }) {
  const blocks = await getCmsBlocks([BANNER_KEY, ...REFUSAL_KEYS]);
  const banner = blocks.find((b) => b.key === BANNER_KEY);
  return (
    <CmsOverridesProvider refusals={refusalOverrides(blocks)}>
      {banner?.html && <AnnouncementBanner html={banner.html} />}
      {header}
      {children}
    </CmsOverridesProvider>
  );
}
