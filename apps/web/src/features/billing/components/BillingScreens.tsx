"use client";
import Link from "next/link";
import { Badge, Button, Card, Skeleton, buttonStyles } from "@/components/ui";
import { isDegraded } from "@/lib/api";
import { formatDateTime, tierLabel } from "@/lib/format";
import type { SubscriptionResponse } from "@/lib/types";
import { useMe } from "@/features/auth";
import { PricingView } from "./PricingView";
import { useCheckout, usePlans, usePortal, useSubscription } from "../hooks/useBilling";

export function PricingScreen() {
  const plans = usePlans();
  const me = useMe();
  const checkout = useCheckout();
  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 px-4 py-12">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-5xl">Pick the room you need</h1>
        <p className="text-muted">Start as a guest. Upgrade only if you hit a limit.</p>
      </div>
      <PricingView
        data={plans.data}
        loading={plans.isPending}
        currentTier={me.data?.tier}
        signedIn={!!me.data?.user}
        onCheckout={(plan) => checkout.mutate(plan)}
        checkingOut={checkout.isPending}
        error={checkout.error ?? plans.error}
      />
    </main>
  );
}

/** Presentational account billing card: no subscription, active, or ending. */
export function BillingView({
  tier,
  subscription,
  onPortal,
  portalPending,
  error,
}: {
  tier: string;
  subscription: SubscriptionResponse | null;
  onPortal: () => void;
  portalPending?: boolean;
  error?: unknown;
}) {
  return (
    <Card className="space-y-4" data-testid="billing-card">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl">Your plan</h2>
        <Badge tone={tier === "PRO" ? "signal" : "neutral"}>{tierLabel(tier)}</Badge>
      </div>
      {subscription ? (
        <>
          <p className="text-sm text-muted">
            {subscription.cancelAtPeriodEnd
              ? `Pro stays active until ${formatDateTime(subscription.currentPeriodEnd)}, then moves to Free. You can resume any time before then.`
              : `Pro renews on ${formatDateTime(subscription.currentPeriodEnd)}.`}
          </p>
          <Button onClick={onPortal} disabled={portalPending}>
            {portalPending ? "Opening…" : "Manage billing"}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">You&apos;re on the {tierLabel(tier)} plan. Pro lifts the limits on quality, file size and daily downloads.</p>
          <Link href="/pricing" className={buttonStyles("primary")}>
            Compare plans
          </Link>
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {isDegraded(error) ? "Billing is paused for a moment. Please try again shortly." : "We couldn't open billing. Please try again."}
        </p>
      ) : null}
    </Card>
  );
}

export function BillingScreen() {
  const me = useMe();
  const signedIn = !!me.data?.user;
  const sub = useSubscription(signedIn);
  const portal = usePortal();
  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-12">
      <h1 className="font-display text-4xl">Billing</h1>
      {me.isPending ? (
        <Skeleton className="h-40" />
      ) : !signedIn ? (
        <Card className="space-y-3">
          <p>Sign in to see your plan and manage billing.</p>
          <Link href="/login" className={buttonStyles("primary")}>
            Sign in
          </Link>
        </Card>
      ) : sub.isPending ? (
        <Skeleton className="h-40" />
      ) : (
        <BillingView tier={me.data!.tier} subscription={sub.data ?? null} onPortal={() => portal.mutate()} portalPending={portal.isPending} error={portal.error ?? sub.error} />
      )}
    </main>
  );
}
