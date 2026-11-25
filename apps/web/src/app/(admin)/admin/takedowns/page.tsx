import { Suspense } from "react";
import { Takedowns } from "@/features/admin";

export const metadata = { title: "Takedowns · Admin · Media" };

// useSearchParams (URL-synced filters) needs a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <Takedowns />
    </Suspense>
  );
}
