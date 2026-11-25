import { Suspense } from "react";
import { Users } from "@/features/admin";

export const metadata = { title: "Users · Admin · Media" };

// useSearchParams (URL-synced filters) needs a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <Users />
    </Suspense>
  );
}
