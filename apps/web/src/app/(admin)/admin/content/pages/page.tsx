import { Suspense } from "react";
import { PagesList } from "@/features/cms/pages";

export const metadata = { title: "Pages · Admin · Media" };

// useSearchParams (URL-synced filters) needs a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <PagesList />
    </Suspense>
  );
}
