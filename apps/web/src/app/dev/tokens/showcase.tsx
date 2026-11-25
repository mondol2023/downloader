"use client";
import { useState } from "react";
import { Badge, Button, Card, Progress, Sheet, Skeleton, Toast } from "@/components/ui";

const swatches = ["surface-0", "surface-1", "surface-2", "line", "text", "muted", "signal", "success", "danger"];

export function TokenShowcase({ theme }: { theme: "dark" | "light" }) {
  const [toast, setToast] = useState(false);
  return (
    <div data-theme={theme === "light" ? "light" : undefined} className="space-y-5 rounded-deck border border-line bg-surface-0 p-5 text-text">
      <h2 className="font-display text-2xl capitalize">{theme}</h2>
      <div className="grid grid-cols-3 gap-2">
        {swatches.map((s) => (
          <div key={s} className="text-xs">
            <div className="h-10 rounded-md border border-line" style={{ background: `var(--${s})` }} />
            <span className="num text-muted">{s}</span>
          </div>
        ))}
      </div>
      <p className="font-display text-xl">Fraunces display title</p>
      <p>Geist Sans UI text</p>
      <p className="num text-muted">1920×1080 · 24.5 MB · 3.2 MB/s · ETA 00:42</p>
      <div className="flex flex-wrap gap-2">
        <Button>Download</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button disabled>Disabled</Button>
      </div>
      <div className="flex gap-2">
        <Badge>1080p</Badge>
        <Badge tone="signal">PRO</Badge>
        <Badge tone="success">Ready</Badge>
        <Badge tone="danger">Failed</Badge>
      </div>
      <Card><Progress value={62} label="Download progress" /></Card>
      <Skeleton className="h-10 w-full" />
      <div className="flex gap-2">
        <Sheet trigger={<Button variant="secondary">Open sheet</Button>} title="Sheet"><p className="text-muted">Sheet content.</p></Sheet>
        <Button variant="secondary" onClick={() => setToast(true)}>Show toast</Button>
      </div>
      <Toast open={toast} onOpenChange={setToast} title="Download ready" description="Your file is ready to save." />
    </div>
  );
}
