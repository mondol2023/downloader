import { notFound } from "next/navigation";
import { TokenShowcase } from "./showcase";

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto max-w-5xl space-y-10 p-6">
      <h1 className="font-display text-4xl">Design tokens</h1>
      <div className="grid gap-6 md:grid-cols-2">
        <TokenShowcase theme="dark" />
        <TokenShowcase theme="light" />
      </div>
    </main>
  );
}
