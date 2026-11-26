"use client";
import { useQuery } from "@tanstack/react-query";
import type { QuotaSnapshot } from "@media/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export const useQuota = () =>
  useQuery({ queryKey: queryKeys.quota(), queryFn: () => api<QuotaSnapshot>("/jobs/quota"), staleTime: 15_000 });
