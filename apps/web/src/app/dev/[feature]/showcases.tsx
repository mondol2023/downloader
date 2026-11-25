"use client";
import { useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { AuthForm } from "@/features/auth";
import { BillingView, PricingView } from "@/features/billing";
import { ExtractDeckView, type DeckStatus } from "@/features/extract";
import { MediaNotFound, MediaSkeleton, MediaView } from "@/features/formats";
import { QuotaMeter } from "@/features/history";
import { JobCard, JobListView } from "@/features/jobs";
import { PlayerView } from "@/features/player";
import type { DevFeature } from "./features";
import { MOCK_GRANT, MOCK_PLANS, MOCK_QUOTA, mockExtract, mockJob } from "@/mocks/media";


function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-6" data-dev-state={title}>
      <h2 className="num text-xs uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

const noop = () => {};

function ExtractStates() {
  const [v, setV] = useState("https://example.com/watch?v=abc");
  const row = (title: string, status: DeckStatus, value: string, extra: { error?: unknown; degraded?: boolean } = {}) => (
    <Section key={title} title={title}>
      <ExtractDeckView value={value} onChange={setV} onSubmit={noop} status={status} {...extra} />
    </Section>
  );
  return (
    <>
      {row("idle", "idle", "")}
      {row("typing", "typing", "youtu")}
      {row("typing, valid (seated)", "typing", v)}
      {row("invalid URL", "invalid", "not a link")}
      {row("extracting", "extracting", "https://example.com/watch?v=abc")}
      {row("refused: SOURCE_PRIVATE", "refused", "https://youtu.be/x", { error: new ApiError(403, "SOURCE_PRIVATE", "private") })}
      {row("refused: SOURCE_DRM", "refused", "https://example.com/x", { error: new ApiError(403, "SOURCE_DRM", "drm") })}
      {row("generic error", "error", "https://example.com/x", { error: new ApiError(502, "UPSTREAM_FAILED", "The site didn't answer.") })}
      {row("degraded banner", "idle", "", { degraded: true })}
    </>
  );
}

function FormatsStates() {
  return (
    <>
      <Section title="guest: locked formats + upsell">
        <MediaView result={mockExtract()} onDownload={noop} />
      </Section>
      <Section title="download failure: quota">
        <MediaView result={mockExtract()} error={new ApiError(429, "TOO_MANY_REQUESTS", "limit")} onDownload={noop} />
      </Section>
      <Section title="loading">
        <MediaSkeleton />
      </Section>
      <Section title="expired">
        <MediaNotFound />
      </Section>
    </>
  );
}

function PlayerStates() {
  const poster = null;
  const common = { poster, title: "Big Buck Bunny", subtitles: MOCK_GRANT.subtitles, grant: MOCK_GRANT, onPlay: noop, onFatal: noop };
  return (
    <div className="max-w-2xl space-y-8">
      <Section title="poster">
        <PlayerView phase="poster" {...common} grant={null} />
      </Section>
      <Section title="loading">
        <PlayerView phase="loading" {...common} grant={null} />
      </Section>
      <Section title="error">
        <PlayerView phase="error" {...common} grant={null} error={new Error("x")} />
      </Section>
      <Section title="error: not on plan">
        <PlayerView phase="error" {...common} grant={null} error={new ApiError(403, "FORBIDDEN", "no")} />
      </Section>
    </div>
  );
}

const STATES = ["queued", "extracting", "downloading", "processing", "completed", "failed", "cancelled"] as const;

function JobsStates() {
  return (
    <div className="max-w-2xl space-y-6">
      {STATES.map((s) => (
        <Section key={s} title={s}>
          <JobCard job={mockJob(s)} onCancel={noop} />
        </Section>
      ))}
      <Section title="failed: generic">
        <JobCard job={mockJob("failed", { error: "Download interrupted" })} />
      </Section>
      <Section title="list: loading">
        <JobListView jobs={undefined} loading />
      </Section>
      <Section title="list: empty">
        <JobListView jobs={[]} />
      </Section>
    </div>
  );
}

function AuthStates() {
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <Section title="login">
        <AuthForm mode="login" onSubmit={noop} />
      </Section>
      <Section title="register">
        <AuthForm mode="register" onSubmit={noop} />
      </Section>
      <Section title="field errors">
        <AuthForm mode="register" onSubmit={noop} error={new ApiError(422, "UNPROCESSABLE", "Request validation failed", { details: [{ path: "email", message: "Enter a valid email address" }, { path: "password", message: "Password must be at least 10 characters" }] })} />
      </Section>
      <Section title="degraded (503)">
        <AuthForm mode="login" onSubmit={noop} error={new ApiError(503, "DEGRADED", "down")} />
      </Section>
      <Section title="pending">
        <AuthForm mode="login" onSubmit={noop} pending />
      </Section>
      <Section title="wrong password">
        <AuthForm mode="login" onSubmit={noop} error={new ApiError(401, "UNAUTHORIZED", "That email and password don't match.")} />
      </Section>
    </div>
  );
}

function BillingStates() {
  return (
    <div className="space-y-8">
      <Section title="pricing: guest">
        <PricingView data={MOCK_PLANS} signedIn={false} currentTier="GUEST" onCheckout={noop} />
      </Section>
      <Section title="pricing: free user">
        <PricingView data={MOCK_PLANS} signedIn currentTier="FREE" onCheckout={noop} />
      </Section>
      <Section title="pricing: billing off">
        <PricingView data={{ ...MOCK_PLANS, plans: [], billingEnabled: false }} signedIn currentTier="FREE" onCheckout={noop} />
      </Section>
      <Section title="pricing: loading">
        <PricingView loading signedIn={false} onCheckout={noop} />
      </Section>
      <div className="grid gap-6 md:grid-cols-3">
        <Section title="billing: no subscription">
          <BillingView tier="FREE" subscription={null} onPortal={noop} />
        </Section>
        <Section title="billing: active">
          <BillingView tier="PRO" subscription={{ status: "active", priceId: "p", currentPeriodEnd: "2026-12-25T00:00:00.000Z", cancelAtPeriodEnd: false }} onPortal={noop} />
        </Section>
        <Section title="billing: ending">
          <BillingView tier="PRO" subscription={{ status: "active", priceId: "p", currentPeriodEnd: "2026-12-25T00:00:00.000Z", cancelAtPeriodEnd: true }} onPortal={noop} error={new ApiError(503, "DEGRADED", "x")} />
        </Section>
      </div>
    </div>
  );
}

function HistoryStates() {
  return (
    <div className="max-w-xl space-y-6">
      <Section title="some used">
        <QuotaMeter quota={MOCK_QUOTA} />
      </Section>
      <Section title="full">
        <QuotaMeter quota={{ ...MOCK_QUOTA, downloadsUsed: 3 }} />
      </Section>
      <Section title="unlimited (pro)">
        <QuotaMeter quota={{ ...MOCK_QUOTA, tier: "PRO", downloadsLimit: null as unknown as number, downloadsUsed: 42 }} />
      </Section>
      <Section title="loading">
        <QuotaMeter loading />
      </Section>
    </div>
  );
}

const VIEWS: Record<DevFeature, () => ReactNode> = {
  extract: () => <ExtractStates />,
  formats: () => <FormatsStates />,
  player: () => <PlayerStates />,
  jobs: () => <JobsStates />,
  auth: () => <AuthStates />,
  billing: () => <BillingStates />,
  history: () => <HistoryStates />,
};

export function Showcase({ feature }: { feature: DevFeature }) {
  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6">
      <h1 className="font-display text-4xl">/dev/{feature}</h1>
      {VIEWS[feature]()}
    </main>
  );
}
