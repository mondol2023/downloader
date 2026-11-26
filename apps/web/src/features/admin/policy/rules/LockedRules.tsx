import { Card } from "@/components/ui";
import { LABELS } from "../HardFloor";
import type { PolicyAdminResponse } from "../types";

/** Read-only rows for the hard floor (HARD_FLOOR in code): no switches, no buttons. */
export function LockedRules({ floor }: { floor: PolicyAdminResponse["hardFloor"] }) {
  const rows = [
    ...floor.refuse.map((c) => ({ key: c, label: LABELS[c] ?? c, why: "Always refused" })),
    { key: "age", label: `Age ${floor.maxAgeLimit + 1}+`, why: "Always refused" },
  ];
  return (
    <Card className="space-y-3" data-testid="hard-floor">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="text-muted">
          <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        Locked rules
      </h2>
      <p className="text-sm text-muted">Enforced in code. Nothing you add below can loosen them.</p>
      <ul className="divide-y divide-line" aria-label="Locked rules">
        {rows.map((r) => (
          <li key={r.key} data-testid="locked-rule" className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <span>{r.label}</span>
            <span className="text-xs text-muted">{r.why}</span>
          </li>
        ))}
      </ul>
      <details className="text-xs text-muted">
        <summary className="min-h-11 cursor-pointer py-3">{floor.blockedHosts.length} DRM-only hosts</summary>
        <p className="num">{floor.blockedHosts.join(", ")}</p>
      </details>
    </Card>
  );
}
