"use client";
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, type FormEvent } from "react";
import { useRefusalCopy } from "@/features/cms/render/overrides";
import { Badge, Button, Skeleton } from "@/components/ui";
import { ApiError, isDegraded } from "@/lib/api";
import { duration, ease, spring } from "@/design/motion";
import { cn } from "@/lib/cn";
import { isRefusalCode, NEXT_STEP, parseMediaUrl, platformLabel } from "../copy";

export type DeckStatus = "idle" | "typing" | "invalid" | "extracting" | "refused" | "error";

/** Pure state derivation so the dev page and the real screen can't disagree. */
export function deckStatus(input: { value: string; touched: boolean; extracting: boolean; error: unknown }): DeckStatus {
  if (input.extracting) return "extracting";
  if (input.error instanceof ApiError && isRefusalCode(input.error.code)) return "refused";
  if (input.error && !isDegraded(input.error)) return "error";
  if (!input.value.trim()) return "idle";
  if (input.touched && !parseMediaUrl(input.value)) return "invalid";
  return "typing";
}

/** The "input deck": one large paste field plus every state it can be in. */
export function ExtractDeckView({
  value,
  onChange,
  onSubmit,
  status,
  error,
  degraded,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  status: DeckStatus;
  error?: unknown;
  degraded?: boolean;
}) {
  const id = useId();
  const url = parseMediaUrl(value);
  const seated = status === "typing" && !!url;
  const busy = status === "extracting";
  const reduce = useReducedMotion();
  const refusalCopy = useRefusalCopy();
  const deck = useAnimationControls();
  const wasSeated = useRef(false);
  // The signature "seat": once per paste, on the false -> true edge only (not per keystroke).
  useEffect(() => {
    if (seated && !wasSeated.current && !reduce) void deck.start({ scale: [0.98, 1] }, spring.settle);
    wasSeated.current = seated;
  }, [seated, reduce, deck]);
  const refusal = error instanceof ApiError && isRefusalCode(error.code) ? error.code : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <section aria-label="Paste a link" className="mx-auto w-full max-w-2xl space-y-4">
      <AnimatePresence initial={false}>
      {degraded && (
        <motion.div
          key="degraded"
          role="status"
          data-testid="degraded-banner"
          className="rounded-key border border-signal/40 bg-signal/10 p-3 text-sm"
          initial={reduce ? { opacity: 0 } : { clipPath: "inset(0 0 100% 0)", opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { clipPath: "inset(0 0 0% 0)", opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: duration.base, ease: ease.out }}
        >
          <p className="font-medium">Some features are paused</p>
          <p className="mt-1 text-muted">
            Previewing and downloading as a guest still work. Sign-in and billing are back shortly.
          </p>
        </motion.div>
      )}
      </AnimatePresence>

      <motion.form
        animate={deck}
        onSubmit={submit}
        noValidate
        data-status={status}
        data-seated={seated || undefined}
        className={cn(
          "rounded-deck border bg-surface-1 p-3 transition-colors duration-150 sm:p-4",
          status === "invalid" || status === "refused" || status === "error" ? "border-danger/60" : seated ? "border-signal" : "border-line",
        )}
      >
        <label htmlFor={id} className="sr-only">
          Media URL
        </label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {seated && url && (
              <motion.span
                data-testid="platform-chip"
                className="shrink-0"
                initial={reduce ? { opacity: 0 } : { x: -12, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={spring.settle}
              >
                <Badge tone="signal">{platformLabel(url)}</Badge>
              </motion.span>
            )}
            <input
              id={id}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste a video or audio link"
              value={value}
              disabled={busy}
              onChange={(e) => onChange(e.target.value)}
              aria-invalid={status === "invalid" ? true : undefined}
              aria-describedby={`${id}-msg`}
              className="min-h-14 min-w-0 flex-1 bg-transparent px-2 text-lg text-text placeholder:text-muted focus-visible:outline-none"
            />
          </div>
          <Button type="submit" disabled={busy || status === "idle"} className="min-h-14 sm:px-8">
            {busy ? "Looking…" : "Get formats"}
          </Button>
        </div>
      </motion.form>

      <div id={`${id}-msg`} aria-live="polite" className="min-h-6 text-sm">
        {status === "idle" && <p className="text-muted">Works with public videos and audio. Paste a link to start.</p>}
        {status === "typing" && !seated && <p className="text-muted">Keep going, we&apos;ll check it when you press Enter.</p>}
        {status === "invalid" && (
          <p role="alert" className="text-danger">
            That doesn&apos;t look like a web link yet. Paste the full address, like https://example.com/watch?v=…
          </p>
        )}
        {status === "error" && error instanceof ApiError && (
          <p role="alert" className="text-danger">
            {error.message} Try again in a moment.
          </p>
        )}
      </div>

      {busy && (
        <div aria-busy="true" aria-label="Looking up this link" data-testid="extract-skeleton" className="flex gap-4 rounded-deck border border-line bg-surface-1 p-4">
          <Skeleton className="h-20 w-36 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
      )}

      {refusal && (
        <div role="alert" data-testid="refusal" data-code={refusal} className="rounded-deck border border-danger/40 bg-danger/10 p-5">
          <h2 className="font-display text-xl">{refusalCopy(refusal).title}</h2>
          <p className="mt-1 text-sm text-muted">
            {refusal === "SOURCE_RULE_BLOCKED" && error instanceof ApiError && error.message
              ? error.message
              : refusalCopy(refusal).body}
          </p>
          <p className="mt-3 text-sm">{NEXT_STEP[refusal]}</p>
        </div>
      )}
    </section>
  );
}
