"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PlansResponse, SubscriptionResponse } from "@/lib/types";

export const usePlans = () =>
  useQuery({ queryKey: ["billing", "plans"], queryFn: () => api<PlansResponse>("/billing/plans"), staleTime: 5 * 60_000 });

export const useSubscription = (enabled: boolean) =>
  useQuery({ queryKey: ["billing", "subscription"], queryFn: () => api<SubscriptionResponse | null>("/billing/subscription"), enabled });

const go = (r: { url: string }) => window.location.assign(r.url);

export const useCheckout = () =>
  useMutation({
    mutationFn: (plan: "pro-monthly" | "pro-yearly") => api<{ url: string }>("/billing/checkout", { method: "POST", body: { plan } }),
    onSuccess: go,
  });

export const usePortal = () =>
  useMutation({ mutationFn: () => api<{ url: string }>("/billing/portal", { method: "POST" }), onSuccess: go });
