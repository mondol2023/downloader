import { Suspense } from "react";
import { Audit } from "@/features/admin";

export const metadata = { title: "Audit log · Admin · Media" };

// useSearchParams (URL-synced filters) needs a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <Audit />
    </Suspense>
  );
}
