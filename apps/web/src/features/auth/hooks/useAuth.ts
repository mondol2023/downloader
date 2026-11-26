"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthUser } from "@media/shared";
import { api } from "@/lib/api";
import type { MeResponse } from "@/lib/types";
import { queryKeys } from "@/lib/query-keys";

/** Session bootstrap. Guests get a valid response (user: null, tier: GUEST). */
export function useMe() {
  return useQuery({ queryKey: queryKeys.me(), queryFn: () => api<MeResponse>("/auth/me"), staleTime: 60_000 });
}

export interface Credentials {
  email: string;
  password: string;
  displayName?: string;
}

function useSessionMutation(path: "/auth/login" | "/auth/register") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Credentials) => api<AuthUser>(path, { method: "POST", body: input }),
    onSuccess: () => {
      // Tier-gated data (formats, quota, jobs) differs per identity, so drop it all.
      void qc.invalidateQueries();
    },
  });
}

export const useLogin = () => useSessionMutation("/auth/login");
export const useRegister = () => useSessionMutation("/auth/register");

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      qc.clear();
      void qc.invalidateQueries();
    },
  });
}
