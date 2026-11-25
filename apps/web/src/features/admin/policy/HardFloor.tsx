import { Card } from "@/components/ui";
import type { PolicyAdminResponse } from "./types";

const LABELS: Record<string, string> = {
  SOURCE_PRIVATE: "Private",
  SOURCE_MEMBERS_ONLY: "Members-only",
  SOURCE_NEEDS_LOGIN: "Login required",
  SOURCE_DRM: "DRM",
};

/** Read-only: these rules live in code (HARD_FLOOR) and the override schema has no key for them. */
export function HardFloor({ floor }: { floor: PolicyAdminResponse["hardFloor"] }) {
  return (
    <Card className="space-y-3" data-testid="hard-floor">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="text-muted">
          <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        Hard floor
      </h2>
      <p className="text-sm text-muted">
        These rules are enforced in code and can&apos;t be changed here: private, members-only, login-required, DRM, and DRM-only
        platforms.
      </p>
      <ul className="flex flex-wrap gap-2 text-xs" aria-label="Always refused">
        {floor.refuse.map((c) => (
          <li key={c} className="rounded-md bg-surface-2 px-2 py-0.5 text-muted">
            {LABELS[c] ?? c}
          </li>
        ))}
        <li className="rounded-md bg-surface-2 px-2 py-0.5 text-muted">Age {floor.maxAgeLimit + 1}+</li>
      </ul>
      <details className="text-xs text-muted">
        <summary className="min-h-11 cursor-pointer py-3">{floor.blockedHosts.length} DRM-only hosts</summary>
        <p className="num">{floor.blockedHosts.join(", ")}</p>
      </details>
    </Card>
  );
}
