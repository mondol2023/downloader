import { Suspense } from "react";
import { Jobs } from "@/features/admin";

export const metadata = { title: "Jobs · Admin · Media" };

// useSearchParams (URL-synced filters) needs a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <Jobs />
    </Suspense>
  );
}
