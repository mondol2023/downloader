import { INELIGIBLE_CODES, INELIGIBLE_COPY, type IneligibleCode, type JobSummary } from "@media/shared";

export const STATE_LABEL: Record<JobSummary["state"], string> = {
  queued: "Queued",
  extracting: "Preparing",
  downloading: "Downloading",
  processing: "Processing",
  completed: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** The five visible steps of the happy path, in order. */
export const STEPS: JobSummary["state"][] = ["queued", "extracting", "downloading", "processing", "completed"];

/** A failed job carries either a typed `SOURCE_*` refusal or a plain message; never blame the user. */
export function describeJobError(error: string | null): { title: string; body: string } {
  const code = error ? INELIGIBLE_CODES.find((c) => error.includes(c)) : undefined;
  if (code) return INELIGIBLE_COPY[code as IneligibleCode];
  return {
    title: "This download didn't finish",
    body: error && !/^[A-Z_]+$/.test(error) ? error : "Something went wrong on our side. Starting it again usually works.",
  };
}
