"use client";
import Link from "next/link";
import { motion, useAnimate, type Variants } from "motion/react";
import { useEffect, useState } from "react";
import { AUDIO_FORMATS, LOCK_MESSAGES, policyFor, type AudioFormat, type GatedMediaFormat, type SubtitleTrack, type Tier } from "@media/shared";
import { Badge } from "@/components/ui";
import { duration, spring, staggerDelay } from "@/design/motion";
import { useSafeVariants } from "@/design/use-motion-safe";
import { cn } from "@/lib/cn";
import { formatBytes, tierLabel } from "@/lib/format";
import { groupFormats } from "../group";

function Lock({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

/** One hardware-style selector key. Locked keys stay visible and explain themselves. */
const KEY_DELAY = 0.12; // let the title land first, then the options

const keyVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { ...spring.gentle, delay: KEY_DELAY + staggerDelay(i) } }),
};

function FormatKey({ f, index, shake, selected, recommended, onPick }: { f: GatedMediaFormat; index: number; shake: number; selected: boolean; recommended: boolean; onPick: (f: GatedMediaFormat) => void }) {
  const variants = useSafeVariants(keyVariants);
  const [scope, animate] = useAnimate<HTMLButtonElement>();
  // A tap on a locked key: two-step ±3px shake. Reduced motion is handled by MotionConfig (transforms skipped).
  useEffect(() => {
    if (shake > 0) void animate(scope.current, { x: [0, -3, 3, -3, 3, 0] }, { duration: duration.fast * 2 });
  }, [shake, animate, scope]);
  return (
    <motion.button
      ref={scope}
      variants={variants}
      custom={index}
      initial="hidden"
      animate="visible"
      whileTap={{ scale: 0.97 }}
      transition={spring.snappy}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={!f.allowed || undefined}
      data-locked={!f.allowed || undefined}
      data-format-id={f.id}
      onClick={() => onPick(f)}
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-3 rounded-key border px-4 py-2 text-left transition-[border-color,background-color] duration-150",
        selected ? "border-signal bg-signal/10" : "border-line bg-surface-1 hover:border-muted",
        !f.allowed && "text-muted",
      )}
    >
      <span className="flex items-center gap-2">
        {!f.allowed && <Lock />}
        <span className="num font-medium">{f.label}</span>
        <span className="num text-xs text-muted">{f.container.toUpperCase()}</span>
        {recommended && f.allowed && <Badge tone="signal">Best for you</Badge>}
      </span>
      <span className="flex items-center gap-2">
        {f.sizeBytes != null && (
          <span className="num text-xs text-muted">
            {f.sizeIsEstimate ? "~" : ""}
            {formatBytes(f.sizeBytes)}
          </span>
        )}
        {!f.allowed && <Badge tone="neutral">{tierLabel(f.requiredTier)}</Badge>}
      </span>
    </motion.button>
  );
}

export interface PickerState {
  formatId: string | null;
  audioFormat: AudioFormat | null;
  subtitleLang: string | null;
}

/** Grouped Video / Audio-only / Subtitles. Controlled: the parent owns selection. */
export function FormatPicker({
  formats,
  tier,
  recommendedFormatId,
  subtitles,
  value,
  onChange,
}: {
  formats: GatedMediaFormat[];
  tier: Tier;
  recommendedFormatId: string | null;
  subtitles: SubtitleTrack[];
  value: PickerState;
  onChange: (next: PickerState) => void;
}) {
  const [lockedPick, setLockedPick] = useState<GatedMediaFormat | null>(null);
  const [shake, setShake] = useState<{ id: string; n: number }>({ id: "", n: 0 });
  const groups = groupFormats(formats);
  const order = new Map([...groups.video, ...groups.audio].map((f, i) => [f.id, i]));
  const policy = policyFor(tier);
  const selected = formats.find((f) => f.id === value.formatId);
  const audioOnlySelected = !!selected && !selected.hasVideo;

  const pick = (f: GatedMediaFormat) => {
    if (!f.allowed) {
      setShake((s) => ({ id: f.id, n: s.n + 1 }));
      return setLockedPick(f);
    }
    setLockedPick(null);
    onChange({ ...value, formatId: f.id, audioFormat: f.hasVideo ? null : value.audioFormat });
  };

  const group = (title: string, items: GatedMediaFormat[], id: string) =>
    items.length > 0 && (
      <section key={id} aria-labelledby={`g-${id}`} className="space-y-2">
        <h3 id={`g-${id}`} className="text-xs font-medium uppercase tracking-wide text-muted">
          {title}
        </h3>
        <div role="radiogroup" aria-labelledby={`g-${id}`} className="space-y-2">
          {items.map((f) => (
            <FormatKey key={f.id} f={f} index={order.get(f.id) ?? 0} shake={shake.id === f.id ? shake.n : 0} selected={value.formatId === f.id} recommended={f.id === recommendedFormatId} onPick={pick} />
          ))}
        </div>
      </section>
    );

  return (
    <div className="space-y-6" data-testid="format-picker">
      {group("Video", groups.video, "video")}
      {group("Audio only", groups.audio, "audio")}

      {lockedPick && (
        <div role="status" data-testid="upsell" className="rounded-key border border-signal/40 bg-signal/10 p-3 text-sm">
          <p>{lockedPick.lockReason ? LOCK_MESSAGES[lockedPick.lockReason] : "This one needs a higher plan."}</p>
          <p className="mt-1">
            <Link href={lockedPick.requiredTier === "FREE" ? "/register" : "/pricing"} className="font-medium text-signal underline">
              {lockedPick.requiredTier === "FREE" ? "Create a free account" : `Upgrade to ${tierLabel(lockedPick.requiredTier)} for ${lockedPick.label}`}
            </Link>
          </p>
        </div>
      )}

      {audioOnlySelected && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Save as</span>
          <select
            aria-label="Audio format"
            value={value.audioFormat ?? ""}
            onChange={(e) => onChange({ ...value, audioFormat: (e.target.value || null) as AudioFormat | null })}
            className="min-h-11 rounded-key border border-line bg-surface-1 px-2"
          >
            <option value="">Original</option>
            {AUDIO_FORMATS.map((a) => {
              const ok = policy.allowTranscode && policy.audioFormats.includes(a);
              return (
                <option key={a} value={a} disabled={!ok}>
                  {a.toUpperCase()}
                  {ok ? "" : policy.allowTranscode ? " (Pro)" : " (free account)"}
                </option>
              );
            })}
          </select>
        </label>
      )}

      {subtitles.length > 0 && (
        <section aria-labelledby="g-subs" className="space-y-2">
          <h3 id="g-subs" className="text-xs font-medium uppercase tracking-wide text-muted">
            Subtitles
          </h3>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Add to the file</span>
            <select
              aria-label="Subtitle language"
              value={value.subtitleLang ?? ""}
              onChange={(e) => onChange({ ...value, subtitleLang: e.target.value || null })}
              className="min-h-11 rounded-key border border-line bg-surface-1 px-2"
            >
              <option value="">None</option>
              {subtitles.map((s) => (
                <option key={s.lang} value={s.lang}>
                  {s.label}
                  {s.autoGenerated ? " (auto)" : ""}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}
    </div>
  );
}
