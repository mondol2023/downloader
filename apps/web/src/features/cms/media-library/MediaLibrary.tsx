"use client";
import { MediaGrid } from "./MediaGrid";

export function MediaLibrary() {
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Media library</h1>
      <MediaGrid />
    </div>
  );
}
