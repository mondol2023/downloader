"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { isDegraded } from "@/lib/api";
import { parseMediaUrl } from "../copy";
import { useExtract } from "../hooks/useExtract";
import { deckStatus, ExtractDeckView } from "./ExtractDeck";

/** Home screen: hero copy plus the deck. */
export function ExtractScreen() {
  const router = useRouter();
  const extract = useExtract();
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);

  function onChange(v: string) {
    setValue(v);
    setTouched(false);
    if (extract.error) extract.reset();
  }

  function onSubmit() {
    setTouched(true);
    const url = parseMediaUrl(value);
    if (!url || extract.isPending) return;
    extract.mutate(url.toString(), { onSuccess: (r) => router.push(`/m/${encodeURIComponent(r.media.id)}`) });
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-10 px-4 py-16">
      <div className="space-y-3 text-center">
        <h1 className="font-display text-5xl tracking-tight sm:text-6xl">Paste a link. Pick a format.</h1>
        <p className="text-lg text-muted">A calm way to save public video and audio, in the quality your plan allows.</p>
      </div>
      <ExtractDeckView
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        status={deckStatus({ value, touched, extracting: extract.isPending, error: extract.error })}
        error={extract.error}
        degraded={isDegraded(extract.error)}
      />
    </main>
  );
}
