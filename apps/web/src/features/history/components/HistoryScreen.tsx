"use client";
import Link from "next/link";
import { JobList } from "@/features/jobs";
import { useMe } from "@/features/auth";
import { useQuota } from "../hooks/useQuota";
import { QuotaMeter } from "./QuotaMeter";

export function HistoryScreen() {
  const quota = useQuota();
  const me = useMe();
  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-10">
      <h1 className="font-display text-4xl">History</h1>
      <QuotaMeter quota={quota.data} loading={quota.isPending} />
      {me.data && !me.data.user && (
        <p className="rounded-key border border-line p-3 text-sm text-muted">
          You&apos;re browsing as a guest, so this list only covers this browser.{" "}
          <Link href="/register" className="text-signal underline">
            Create a free account
          </Link>{" "}
          to keep it.
        </p>
      )}
      <JobList />
    </main>
  );
}
