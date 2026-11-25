import Link from "next/link";
import type { QuotaSnapshot } from "@media/shared";
import { Badge, Card, Progress, Skeleton, buttonStyles } from "@/components/ui";
import { formatDateTime, tierLabel } from "@/lib/format";

/** Used / limit with the reset time. `null` limits are how the API serialises "unlimited". */
export function QuotaMeter({ quota, loading }: { quota?: QuotaSnapshot; loading?: boolean }) {
  if (loading || !quota) return <Skeleton className="h-28" />;
  const unlimited = quota.downloadsLimit == null || !Number.isFinite(quota.downloadsLimit);
  const pct = unlimited ? 0 : (quota.downloadsUsed / quota.downloadsLimit) * 100;
  const full = !unlimited && quota.downloadsUsed >= quota.downloadsLimit;
  return (
    <Card className="space-y-3" data-testid="quota-meter">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted">Downloads in the last 24 hours</h2>
        <Badge tone={quota.tier === "PRO" ? "signal" : "neutral"}>{tierLabel(quota.tier)}</Badge>
      </div>
      <p className="num text-3xl">
        {quota.downloadsUsed}
        <span className="text-lg text-muted"> / {unlimited ? "Unlimited" : quota.downloadsLimit}</span>
      </p>
      {!unlimited && <Progress value={pct} label="Downloads used" />}
      <p className="text-sm text-muted">
        {full && quota.windowResetsAt
          ? `You've used today's downloads. The next one frees up ${formatDateTime(quota.windowResetsAt)}.`
          : unlimited
            ? "No daily limit on your plan."
            : quota.windowResetsAt
              ? `The oldest one frees up ${formatDateTime(quota.windowResetsAt)}.`
              : "Your allowance is untouched."}
      </p>
      {full && quota.tier !== "PRO" && (
        <Link href="/pricing" className={buttonStyles("secondary")}>
          Need more? See plans
        </Link>
      )}
    </Card>
  );
}
