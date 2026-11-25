"use client";
import Link from "next/link";
import { Button } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { formatDateTime, tierLabel } from "@/lib/format";

/** Turns a refused enqueue into something the person can act on. */
function failureCopy(error: unknown): { text: string; link?: { href: string; label: string } } {
  if (error instanceof ApiError) {
    if (error.status === 429 || error.code === "QUOTA_EXCEEDED") {
      return { text: "You've used all of today's downloads. They come back on a rolling 24-hour window.", link: { href: "/pricing", label: "See plans" } };
    }
    if (error.status === 403 && error.extra.requiredTier) {
      return { text: error.message, link: { href: "/pricing", label: `Upgrade to ${tierLabel(error.extra.requiredTier)}` } };
    }
    if (error.status === 503) {
      return { text: error.message || "Downloads are paused for a moment. Please try again shortly." };
    }
    return { text: `${error.message} Try again, or pick another format.` };
  }
  return { text: "We couldn't start that download. Please try again." };
}

export function DownloadBar({
  label,
  sizeText,
  disabled,
  pending,
  error,
  queued,
  resetsAt,
  onDownload,
}: {
  label: string | null;
  sizeText?: string;
  disabled?: boolean;
  pending?: boolean;
  error?: unknown;
  queued?: boolean;
  resetsAt?: string | null;
  onDownload: () => void;
}) {
  const fail = error ? failureCopy(error) : null;
  return (
    <div className="space-y-3 rounded-deck border border-line bg-surface-1 p-4" data-testid="download-bar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {label ? (
            <>
              Selected <span className="num text-text">{label}</span>
              {sizeText ? <span className="num"> · {sizeText}</span> : null}
            </>
          ) : (
            "Choose a format to continue."
          )}
        </p>
        <Button onClick={onDownload} disabled={disabled || pending || !label}>
          {pending ? "Starting…" : "Download"}
        </Button>
      </div>
      {queued && !fail && (
        <p role="status" className="text-sm text-success">
          Added to your downloads. You can keep browsing while it finishes.{" "}
          <Link href="/jobs" className="underline">
            View downloads
          </Link>
        </p>
      )}
      {fail && (
        <p role="alert" className="text-sm text-danger">
          {fail.text}{" "}
          {fail.link && (
            <Link href={fail.link.href} className="font-medium underline">
              {fail.link.label}
            </Link>
          )}
          {resetsAt && error instanceof ApiError && error.status === 429 ? <span className="text-muted"> Resets {formatDateTime(resetsAt)}.</span> : null}
        </p>
      )}
    </div>
  );
}
