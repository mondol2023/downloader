"use client";
import Link from "next/link";
import type { JobSummary } from "@media/shared";
import { Skeleton, buttonStyles } from "@/components/ui";
import { JobCard } from "./JobCard";
import { useCancelJob, useJobs } from "../hooks/useJobs";

/** Presentational list with loading and empty states. */
export function JobListView({
  jobs,
  loading,
  onCancel,
  cancellingId,
}: {
  jobs: JobSummary[] | undefined;
  loading?: boolean;
  onCancel?: (id: string) => void;
  cancellingId?: string | null;
}) {
  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }
  if (!jobs?.length) {
    return (
      <div className="rounded-deck border border-dashed border-line p-10 text-center">
        <p className="font-display text-xl">No downloads yet</p>
        <p className="mt-1 text-sm text-muted">Paste a link on the home screen and your downloads will show up here.</p>
        <Link href="/" className={buttonStyles("primary", "mt-4")}>
          Paste a link
        </Link>
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {jobs.map((j) => (
        <li key={j.id}>
          <JobCard job={j} onCancel={onCancel} cancelling={cancellingId === j.id} />
        </li>
      ))}
    </ul>
  );
}

export function JobList() {
  const { data, isPending, error } = useJobs();
  const cancel = useCancelJob();
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        We couldn&apos;t load your downloads. Refresh to try again.
      </p>
    );
  }
  return (
    <JobListView
      jobs={data}
      loading={isPending}
      onCancel={(id) => cancel.mutate(id)}
      cancellingId={cancel.isPending ? cancel.variables : null}
    />
  );
}
