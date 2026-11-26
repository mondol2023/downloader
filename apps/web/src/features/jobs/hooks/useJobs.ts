"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AudioFormat, JobSummary } from "@media/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { trackJob } from "../store";

export const isTerminal = (s: JobSummary["state"]) => s === "completed" || s === "failed" || s === "cancelled";

/** Polls once a second while the job is active and stops the moment it reaches a terminal state. */
export function useJob(jobId: string) {
  return useQuery({
    queryKey: queryKeys.job(jobId),
    queryFn: () => api<JobSummary>(`/jobs/${jobId}`),
    refetchInterval: (q) => (q.state.data && isTerminal(q.state.data.state) ? false : 1000),
    staleTime: 0,
  });
}

export function useJobs() {
  return useQuery({
    queryKey: queryKeys.jobs(),
    queryFn: () => api<JobSummary[]>("/jobs?limit=50"),
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.some((j) => !isTerminal(j.state)) ? 1500 : false),
  });
}

export interface StartJobInput {
  url: string;
  formatId: string;
  audioFormat?: AudioFormat;
  embedSubtitles?: boolean;
  subtitleLang?: string;
}

export function useStartJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StartJobInput) => api<JobSummary>("/jobs", { method: "POST", body: input }),
    onSuccess: (job) => {
      qc.setQueryData(queryKeys.job(job.id), job);
      trackJob(job.id);
      void qc.invalidateQueries({ queryKey: queryKeys.jobs() });
      void qc.invalidateQueries({ queryKey: queryKeys.quota() });
    },
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api<JobSummary>(`/jobs/${jobId}/cancel`, { method: "POST" }),
    onSuccess: (job) => {
      qc.setQueryData(queryKeys.job(job.id), job);
      void qc.invalidateQueries({ queryKey: queryKeys.jobs() });
      void qc.invalidateQueries({ queryKey: queryKeys.quota() });
    },
  });
}
