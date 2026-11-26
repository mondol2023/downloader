export const queryKeys = {
  media: (mediaId: string) => ["media", mediaId] as const,
  job: (jobId: string) => ["job", jobId] as const,
  jobs: () => ["jobs"] as const,
  quota: () => ["quota"] as const,
  me: () => ["me"] as const,
};
