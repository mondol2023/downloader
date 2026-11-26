"use client";
import Link from "next/link";
import { useState } from "react";
import { formatBytes } from "@media/shared";
import type { Tier } from "@media/shared";
import { Badge, Button, Card, Skeleton, buttonStyles } from "@/components/ui";
import { ApiError, isDegraded } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { PlanPrice, PlanTier, PlansResponse } from "@/lib/types";

const BLURB: Record<Tier, string> = {
  GUEST: "Try it with no account.",
  FREE: "More room, still free.",
  PRO: "No limits on quality or volume.",
};
/** `null` is how the API serialises "unlimited" (Infinity). */
const height = (t: PlanTier) => (t.maxHeight == null ? "Up to 8K" : `${t.maxHeight}p`);
const count = (n: number | null) => (n == null ? "Unlimited" : String(n));

export const money = (p: PlanPrice) =>
  p.amount == null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency.toUpperCase() }).format(p.amount / 100);

export function PricingView({
  data,
  loading,
  currentTier,
  signedIn,
  onCheckout,
  checkingOut,
  error,
}: {
  data?: PlansResponse;
  loading?: boolean;
  currentTier?: Tier;
  signedIn: boolean;
  onCheckout: (plan: PlanPrice["id"]) => void;
  checkingOut?: boolean;
  error?: unknown;
}) {
  const [period, setPeriod] = useState<PlanPrice["id"]>("pro-monthly");
  const price = data?.plans.find((p) => p.id === period);

  if (loading || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-96" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {data.plans.length > 1 && (
        <div role="radiogroup" aria-label="Billing period" className="mx-auto flex w-fit gap-1 rounded-key bg-surface-2 p-1">
          {data.plans.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={period === p.id}
              onClick={() => setPeriod(p.id)}
              className={cn("min-h-11 rounded-key px-4 text-sm", period === p.id ? "bg-surface-1 text-text" : "text-muted hover:text-text")}
            >
              {p.interval === "year" ? "Yearly" : "Monthly"}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3" data-testid="pricing-grid">
        {data.tiers.map((t) => {
          const isPro = t.tier === "PRO";
          const current = currentTier === t.tier;
          return (
            <Card key={t.tier} data-tier={t.tier} className={cn("flex flex-col gap-4", isPro && "border-signal")}>
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl">{t.label}</h2>
                {current && <Badge tone="signal">Your plan</Badge>}
              </div>
              <p className="text-sm text-muted">{BLURB[t.tier]}</p>
              <p className="num text-3xl">{isPro ? (price ? money(price) : "Pro") : "Free"}{isPro && price && <span className="text-sm text-muted"> / {price.interval}</span>}</p>
              <dl className="space-y-2 text-sm">
                {[
                  ["Max quality", height(t)],
                  ["File size", t.maxFileSizeBytes == null ? "Unlimited" : formatBytes(t.maxFileSizeBytes)],
                  ["Downloads / day", count(t.dailyDownloads)],
                  ["At the same time", count(t.maxConcurrentJobs)],
                  ["Audio formats", t.audioFormats.map((a) => a.toUpperCase()).join(", ")],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 border-b border-line pb-2">
                    <dt className="text-muted">{k}</dt>
                    <dd className="num text-right">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-auto">
                {t.tier === "GUEST" && <p className="text-sm text-muted">No sign-up needed.</p>}
                {t.tier === "FREE" && !signedIn && (
                  <Link href="/register" className={buttonStyles("secondary", "w-full")}>
                    Create a free account
                  </Link>
                )}
                {isPro &&
                  (current ? (
                    <Link href="/account/billing" className={buttonStyles("secondary", "w-full")}>
                      Manage plan
                    </Link>
                  ) : !data.billingEnabled ? (
                    <p className="text-sm text-muted">Pro isn&apos;t open for sign-up yet. Check back soon.</p>
                  ) : signedIn ? (
                    <Button className="w-full" disabled={checkingOut || !price} onClick={() => onCheckout(period)}>
                      {checkingOut ? "Opening checkout…" : "Upgrade to Pro"}
                    </Button>
                  ) : (
                    <Link href="/register" className={buttonStyles("primary", "w-full")}>
                      Sign up to upgrade
                    </Link>
                  ))}
              </div>
            </Card>
          );
        })}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {isDegraded(error) ? "Billing is paused for a moment. Please try again shortly." : error instanceof ApiError ? error.message : "Something went wrong. Please try again."}
        </p>
      ) : null}
    </div>
  );
}
