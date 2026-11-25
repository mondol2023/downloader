"use client";
import { motion } from "motion/react";
import { useState } from "react";
import type { JobSummary } from "@media/shared";
import { Badge, Button, Card, Progress, buttonStyles } from "@/components/ui";
import { duration, ease, spring } from "@/design/motion";
import { cn } from "@/lib/cn";
import { formatBytes, formatEta, formatSpeed } from "@/lib/format";
import { STATE_LABEL, STEPS, describeJobError } from "../copy";

const TONE = { completed: "success", failed: "danger", cancelled: "neutral" } as const;

/** One job in every state. Presentational: parents own polling and actions. */
export function JobCard({
  job,
  onCancel,
  cancelling,
  compact,
}: {
  job: JobSummary;
  onCancel?: (id: string) => void;
  cancelling?: boolean;
  compact?: boolean;
}) {
  const { state, progress } = job;
  const active = state === "queued" || state === "extracting" || state === "downloading" || state === "processing";
  const stepIndex = STEPS.indexOf(state);
  // True only when this card watched the job finish; cards that mount already-completed stay quiet.
  const [mountedActive] = useState(active);
  const justCompleted = mountedActive && state === "completed";
  const failure = state === "failed" ? describeJobError(job.error) : null;

  return (
    <Card
      className={cn("space-y-3 transition-colors duration-[220ms]", state === "failed" && "border-danger/60")}
      data-testid="job-card"
      data-state={state}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium" title={job.mediaTitle}>
            {job.mediaTitle}
          </p>
          <p className="num text-xs text-muted">{job.formatLabel}</p>
        </div>
        <Badge tone={TONE[state as keyof typeof TONE] ?? "signal"}>{STATE_LABEL[state]}</Badge>
      </div>

      {active && (
        <>
          <Progress value={state === "queued" ? 0 : progress.percent} label={`${job.mediaTitle} progress`} />
          {/* Fixed ch widths (mono, tabular): left-aligned so a changing width never moves a neighbour, so polling causes no layout shift. */}
          <div className="num flex flex-wrap gap-x-4 text-xs text-muted">
            {state === "downloading" ? (
              <>
                <span className="min-w-[17ch] flex-1">
                  {formatBytes(progress.downloadedBytes ?? 0)}
                  {progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ""}
                </span>
                <span className="w-[9ch] text-left">{formatSpeed(progress.speedBytesPerSecond)}</span>
                <span className="w-[9ch] text-left">ETA {formatEta(progress.etaSeconds)}</span>
              </>
            ) : (
              <span className="flex-1">{progress.stage ?? STATE_LABEL[state]}…</span>
            )}
            <span className="w-[4ch] text-left">{Math.round(progress.percent)}%</span>
          </div>
          {!compact && stepIndex >= 0 && (
            <ol className="flex gap-1" aria-label="Steps">
              {STEPS.map((s, i) => (
                <li
                  key={s}
                  aria-current={i === stepIndex ? "step" : undefined}
                  className={`h-1 flex-1 rounded-full ${i <= stepIndex ? "bg-signal" : "bg-surface-2"}`}
                />
              ))}
            </ol>
          )}
        </>
      )}

      {justCompleted && (
        <motion.div
          aria-hidden
          data-testid="completed-flash"
          className="h-2 w-full rounded-full bg-success"
          initial={{ opacity: 1 }}
          animate={{ opacity: [1, 0.35, 1] }}
          transition={{ duration: duration.slow * 2, ease: ease.inOut, times: [0, 0.4, 1] }}
        />
      )}

      {failure && (
        <div role="alert" className="rounded-key bg-danger/10 p-3 text-sm">
          <p className="font-medium text-danger">{failure.title}</p>
          <p className="mt-1 text-muted">{failure.body}</p>
        </div>
      )}
      {state === "cancelled" && (
        <p className="text-sm text-muted">Cancelled. This one didn&apos;t use any of your downloads.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {state === "completed" && job.downloadUrl && (
          <motion.a
            href={job.downloadUrl}
            download
            className={buttonStyles("primary")}
            initial={justCompleted ? { scale: 0.9, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring.settle}
          >
            Download file
          </motion.a>
        )}
        {state === "completed" && !job.downloadUrl && (
          <p className="text-sm text-muted">This file has expired. Start the download again to get a fresh copy.</p>
        )}
        {active && onCancel && (
          <Button variant="secondary" disabled={cancelling} onClick={() => onCancel(job.id)}>
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        )}
      </div>
    </Card>
  );
}
