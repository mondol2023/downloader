"use client";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import type { AdminStats } from "../types";

export const useAdminStats = () =>
  useQuery({ queryKey: ["admin", "stats"], queryFn: () => api<AdminStats>("/admin/stats"), refetchInterval: 15_000 });

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

function Tile({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <Card className="space-y-1" data-testid="stat-tile">
      <p className="text-xs text-muted">{label}</p>
      <p className={`num text-3xl ${tone === "danger" && value !== 0 ? "text-danger" : ""}`}>{value}</p>
    </Card>
  );
}

/** One series, one hue: bar length is the magnitude, the value is printed beside it (no legend needed). */
export function BarList({ title, rows, empty }: { title: string; rows: Record<string, number>; empty: string }) {
  const entries = Object.entries(rows).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <Card className="space-y-3" data-testid="bar-list">
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {entries.map(([k, n]) => (
            <li key={k} className="grid grid-cols-[minmax(0,12rem)_1fr_3rem] items-center gap-3 text-sm">
              <span className="num truncate" title={k}>
                {k}
              </span>
              <span className="h-2 rounded-r-[4px] bg-signal" style={{ width: `${(n / max) * 100}%` }} aria-hidden />
              <span className="num text-right">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function DashboardView({ stats, loading }: { stats?: AdminStats; loading?: boolean }) {
  if (loading || !stats) return <Skeleton className="h-64" />;
  const q = stats.queueDepth;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl">Dashboard</h1>
        <Badge tone={stats.health.status === "ok" ? "success" : "danger"}>
          {stats.health.status} · {stats.health.region}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Jobs today" value={sum(stats.jobsToday)} />
        <Tile label="Extracts (24 h)" value={sum(stats.extractsByPlatform)} />
        <Tile label="Queue depth" value={q.waiting + q.active + q.delayed} />
        <Tile label="Failed in queue" value={q.failed} tone="danger" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <BarList title="Refusals by code (24 h)" rows={stats.refusalsByCode} empty="No refusals in the last 24 hours." />
        <BarList title="Extracts by platform (24 h)" rows={stats.extractsByPlatform} empty="No extractions yet." />
      </div>
      <BarList title="Jobs today by state" rows={stats.jobsToday} empty="No jobs yet today." />
    </div>
  );
}

export function Dashboard() {
  const s = useAdminStats();
  return <DashboardView stats={s.data} loading={s.isPending} />;
}
