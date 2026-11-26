"use client";
import { useSyncExternalStore } from "react";

/**
 * Ids of the jobs started in this browser. Drives the global toast tray without polling the
 * whole job list on every page. Persisted so a refresh doesn't orphan an active download.
 */
const KEY = "media.trackedJobs";
const EMPTY: readonly string[] = [];
let cache: readonly string[] | null = null;
const listeners = new Set<() => void>();

function read(): readonly string[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    cache = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(-5) : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}
function write(next: readonly string[]) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: tracking stays in memory */
  }
  listeners.forEach((l) => l());
}

export const trackJob = (id: string) => {
  if (!read().includes(id)) write([...read(), id].slice(-5));
};
export const untrackJob = (id: string) => write(read().filter((x) => x !== id));

export function useTrackedJobIds(): readonly string[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => EMPTY,
  );
}
