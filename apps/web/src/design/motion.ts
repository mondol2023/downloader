/** Motion tokens. Seconds + `motion/react` easing/spring shapes. One place to tune the whole app. */
export const duration = { instant: 0.08, fast: 0.15, base: 0.22, slow: 0.32 } as const;

export const ease = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
  exit: [0.4, 0, 1, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export const spring = {
  /** presses, toggles, selector keys */
  snappy: { type: "spring", stiffness: 520, damping: 34, mass: 0.8 },
  /** cards, sheets, layout */
  gentle: { type: "spring", stiffness: 260, damping: 28 },
  /** the one "seat" moment (slight overshoot) */
  settle: { type: "spring", stiffness: 380, damping: 22 },
  /** progress bar width: follows data smoothly between polls */
  progress: { type: "spring", stiffness: 120, damping: 24 },
} as const;

/** Items past `maxItems` appear together with the last staggered one. */
export const stagger = { list: 0.035, grid: 0.05, maxItems: 8 } as const;

/** Delay for item `i` in a staggered group, capped so long lists never feel slow. */
export const staggerDelay = (i: number, step: number = stagger.list) => Math.min(i, stagger.maxItems) * step;
