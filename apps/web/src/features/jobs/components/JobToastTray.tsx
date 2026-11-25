"use client";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, type Ref } from "react";
import { duration, ease, spring } from "@/design/motion";
import { ApiError } from "@/lib/api";
import { useJob, useCancelJob, isTerminal } from "../hooks/useJobs";
import { untrackJob, useTrackedJobIds } from "../store";
import { JobCard } from "./JobCard";

function TrayItem({ jobId, ref }: { jobId: string; ref?: Ref<HTMLDivElement> }) {
  const { data: job, error } = useJob(jobId);
  const cancel = useCancelJob();
  // A job the server no longer knows about (expired, other browser) must not linger forever.
  // Only a 404 means that; a network blip or 5xx must not drop a live download from the tray.
  useEffect(() => {
    if (error instanceof ApiError && error.status === 404) untrackJob(jobId);
  }, [error, jobId]);
  if (!job) return null;
  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0, transition: spring.gentle }}
      exit={{ opacity: 0, x: 16, transition: { duration: duration.fast, ease: ease.exit } }}
      className="relative"
    >
      <JobCard job={job} compact onCancel={(id) => cancel.mutate(id)} cancelling={cancel.isPending} />
      {isTerminal(job.state) && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => untrackJob(jobId)}
          className="absolute right-1 top-1 min-h-11 min-w-11 text-muted hover:text-text"
        >
          ×
        </button>
      )}
    </motion.div>
  );
}

/** Global tray: every download started in this browser, live until dismissed. */
export function JobToastTray() {
  const ids = useTrackedJobIds();
  if (ids.length === 0) return null;
  return (
    <section
      aria-label="Downloads"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-40 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2"
      data-testid="job-tray"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {ids.map((id) => (
          <TrayItem key={id} jobId={id} />
        ))}
      </AnimatePresence>
      <motion.div layout="position" className="self-start">
        <Link href="/jobs" className="text-xs text-muted underline hover:text-text">
          All downloads
        </Link>
      </motion.div>
    </section>
  );
}
