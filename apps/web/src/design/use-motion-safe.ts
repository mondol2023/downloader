"use client";
import { useReducedMotion, type Transition, type Variants } from "motion/react";
import { duration, ease } from "./motion";

type Pose = Record<string, number | string>;

/** Opacity-only fade capped at `duration.fast`: the reduced-motion stand-in for any transform animation. */
const FADE: Transition = { duration: duration.fast, ease: ease.out };

const opacityOnly = (pose: Pose): Pose => (pose.opacity === undefined ? {} : { opacity: pose.opacity });

/**
 * Returns `{ initial, animate, exit, transition }` props. With reduced motion on,
 * every pose keeps only `opacity` and the transition is a short fade. Otherwise
 * the poses and transition pass through untouched.
 */
export function useMotionSafe(poses: { initial: Pose; animate: Pose; exit?: Pose }, transition: Transition) {
  const reduce = useReducedMotion();
  if (!reduce) return { ...poses, transition };
  return {
    initial: opacityOnly(poses.initial),
    animate: opacityOnly(poses.animate),
    exit: poses.exit && opacityOnly(poses.exit),
    transition: FADE,
  };
}

/** Same idea for variant maps (staggered children etc). */
export function useSafeVariants(variants: Variants): Variants {
  const reduce = useReducedMotion();
  if (!reduce) return variants;
  return Object.fromEntries(
    Object.entries(variants).map(([k, v]) =>
      typeof v === "function" || typeof v === "string"
        ? [k, v]
        : [k, { ...opacityOnly(v as Pose), transition: FADE }],
    ),
  );
}
