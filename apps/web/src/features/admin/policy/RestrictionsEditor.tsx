"use client";
import { Card } from "@/components/ui";
import { HostChips, NumberField, SwitchField, TextField } from "./fields";
import { PolicyScreen } from "./PolicyScreen";

export function RestrictionsFields() {
  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <h2 className="text-sm font-medium text-muted">Global switches</h2>
        <SwitchField path="global.maintenanceMode" label="Maintenance mode" hint="Blocks new extractions and downloads for everyone." />
        <TextField path="global.maintenanceMessage" label="Maintenance message" multiline />
        <SwitchField path="global.extractionEnabled" label="Link lookup (extraction)" />
        <SwitchField path="global.downloadsEnabled" label="Downloads" />
        <SwitchField path="global.allowLiveVod" label="Allow finished live streams (VOD)" />
      </Card>
      <Card className="space-y-4">
        <h2 className="text-sm font-medium text-muted">Limits</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField path="global.maxDurationSec" label="Max duration (seconds)" hint="Longer sources are refused." />
          <NumberField path="global.ageLimitMax" label="Max age limit" hint="17 at most: the hard floor refuses 18+." />
        </div>
      </Card>
      <Card>
        <HostChips path="global.extraBlockedHosts" label="Extra blocked hosts" />
      </Card>
    </div>
  );
}

export const RestrictionsEditor = () => (
  <PolicyScreen title="Restrictions">
    <RestrictionsFields />
  </PolicyScreen>
);
