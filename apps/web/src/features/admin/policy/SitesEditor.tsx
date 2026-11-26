"use client";
import { NumberField, SwitchField, TextField } from "./fields";
import { PolicyScreen } from "./PolicyScreen";
import { PLATFORM_IDS } from "./types";

export function SitesFields() {
  return (
    <ul className="divide-y divide-line rounded-deck border border-line bg-surface-1">
      {PLATFORM_IDS.map((id) => (
        <li key={id} className="grid gap-3 p-4 md:grid-cols-[8rem_repeat(3,auto)_7rem_1fr] md:items-start" data-testid={`site-${id}`}>
          <p className="num pt-3 text-sm">{id}</p>
          <SwitchField path={`platforms.${id}.enabled`} label="Enabled" />
          <SwitchField path={`platforms.${id}.download`} label="Download" />
          <SwitchField path={`platforms.${id}.playback`} label="Playback" />
          <NumberField path={`platforms.${id}.maxHeight`} label="Max height" allowNull compact />
          <TextField path={`platforms.${id}.note`} label="Note" />
        </li>
      ))}
    </ul>
  );
}

export const SitesEditor = () => (
  <PolicyScreen title="Sites">
    <SitesFields />
  </PolicyScreen>
);
