import type { ReactNode } from "react";
import { ContentTabs } from "@/features/cms/ContentTabs";

export default function ContentLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <ContentTabs />
      {children}
    </div>
  );
}
