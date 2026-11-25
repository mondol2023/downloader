"use client";
import { MB } from "./draft";
import { NumberField, SwitchField } from "./fields";
import { PolicyScreen } from "./PolicyScreen";
import { TIERS } from "./types";

const NUMBERS: Array<{ key: string; label: string; scale?: number; unit?: string }> = [
  { key: "maxHeight", label: "Max height", unit: "px" },
  { key: "maxFps", label: "Max fps" },
  { key: "maxFileSizeBytes", label: "Max file size", scale: MB, unit: "MB" },
  { key: "dailyDownloads", label: "Downloads / day" },
  { key: "hourlyExtractions", label: "Extractions / hour" },
  { key: "maxConcurrentJobs", label: "Concurrent jobs" },
  { key: "maxPlaylistItems", label: "Playlist items" },
];
const SWITCHES = [
  { key: "allowTranscode", label: "Transcode" },
  { key: "allowStreaming", label: "Streaming" },
];

export function TiersFields() {
  return (
    <div className="overflow-x-auto rounded-deck border border-line bg-surface-1">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th scope="col" className="p-3 font-normal">Limit</th>
            {TIERS.map((t) => (
              <th key={t} scope="col" className="p-3 font-normal">{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {NUMBERS.map((n) => (
            <tr key={n.key} className="border-t border-line">
              <th scope="row" className="p-3 font-normal">
                {n.label}
                {n.unit && <span className="ml-1 text-xs text-muted">({n.unit})</span>}
              </th>
              {TIERS.map((t) => (
                <td key={t} className="p-2">
                  <NumberField path={`tiers.${t}.${n.key}`} label={`${t} ${n.label}`} scale={n.scale} allowNull compact />
                </td>
              ))}
            </tr>
          ))}
          {SWITCHES.map((s) => (
            <tr key={s.key} className="border-t border-line">
              <th scope="row" className="p-3 font-normal">{s.label}</th>
              {TIERS.map((t) => (
                <td key={t} className="p-2">
                  <SwitchField path={`tiers.${t}.${s.key}`} label={`${t} ${s.label}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const TiersEditor = () => (
  <PolicyScreen title="Tiers">
    <TiersFields />
  </PolicyScreen>
);
