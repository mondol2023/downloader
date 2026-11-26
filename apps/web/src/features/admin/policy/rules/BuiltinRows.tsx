"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import type { BuiltinToggleId } from "@media/shared";
import { Button, Card, Sheet } from "@/components/ui";
import { HostChips, NumberField, TextField } from "../fields";
import { usePolicyDraft } from "../usePolicyDraft";

function Row({ id, title, hint, checked, onChange, edit }: {
  id: string; title: string; hint: string; checked: boolean; onChange: (on: boolean) => void; edit?: ReactNode;
}) {
  return (
    <li data-testid={`builtin-${id}`} className="flex flex-wrap items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm">{title}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <div className="flex items-center gap-2">
        {edit && (
          <Sheet title={title} trigger={<Button type="button" variant="secondary">Edit</Button>}>
            {edit}
          </Sheet>
        )}
        <input
          type="checkbox"
          role="switch"
          aria-label="Enabled"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="size-6 shrink-0 accent-[var(--color-signal)]"
        />
      </div>
    </li>
  );
}

/** The old global settings as switchable rows. A switch on means the restriction applies. */
export function BuiltinRows() {
  const { get, set } = usePolicyDraft();
  const off = get<BuiltinToggleId[]>("disabledBuiltins") ?? [];
  const toggle = (id: BuiltinToggleId) => (on: boolean) =>
    set("disabledBuiltins", on ? off.filter((x) => x !== id) : [...new Set([...off, id])]);
  const active = (id: BuiltinToggleId) => !off.includes(id);

  return (
    <Card className="space-y-2">
      <h2 className="text-sm font-medium text-muted">Built-in restrictions</h2>
      <ul className="divide-y divide-line">
        <Row
          id="maintenance" title="Maintenance mode" hint="Blocks new lookups and downloads for everyone."
          checked={get<boolean>("global.maintenanceMode")} onChange={(on) => set("global.maintenanceMode", on)}
          edit={<TextField path="global.maintenanceMessage" label="Maintenance message" multiline />}
        />
        <Row
          id="extraction" title="Block link lookup" hint="Nobody can look up new links."
          checked={!get<boolean>("global.extractionEnabled")} onChange={(on) => set("global.extractionEnabled", !on)}
        />
        <Row
          id="downloads" title="Block downloads" hint="Lookups still work."
          checked={!get<boolean>("global.downloadsEnabled")} onChange={(on) => set("global.downloadsEnabled", !on)}
        />
        <Row
          id="liveVod" title="Block finished live streams (VOD)" hint="Refuses recordings of past live streams."
          checked={!get<boolean>("global.allowLiveVod")} onChange={(on) => set("global.allowLiveVod", !on)}
        />
        <Row
          id="maxDuration" title="Maximum duration" hint="Longer sources are refused."
          checked={active("maxDuration")} onChange={toggle("maxDuration")}
          edit={<NumberField path="global.maxDurationSec" label="Max duration (seconds)" hint="Longer sources are refused." />}
        />
        <Row
          id="ageLimit" title="Age limit" hint="Switched off, the hard floor's 17 still applies."
          checked={active("ageLimit")} onChange={toggle("ageLimit")}
          edit={<NumberField path="global.ageLimitMax" label="Max age limit" hint="17 at most: the hard floor refuses 18+." />}
        />
        <Row
          id="blockedHosts" title="Extra blocked hosts" hint="DRM-only hosts stay blocked either way."
          checked={active("blockedHosts")} onChange={toggle("blockedHosts")}
          edit={<HostChips path="global.extraBlockedHosts" label="Extra blocked hosts" />}
        />
      </ul>
      <p className="pt-2 text-sm text-muted">
        Per-site and per-plan limits live on <Link className="underline" href="/admin/sites">Sites</Link> and{" "}
        <Link className="underline" href="/admin/tiers">Tiers</Link>.
      </p>
    </Card>
  );
}
