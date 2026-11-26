"use client";
import { useId, useState, type FormEvent } from "react";
import { Button, Card } from "@/components/ui";
import { api, ApiError, fieldErrors } from "@/lib/api";

/** Public DMCA notice. Submitting creates a PENDING request that an admin reviews; it never blocks anything by itself. */
export function DmcaForm() {
  const id = useId();
  const [v, setV] = useState({ sourceUrl: "", requesterName: "", requesterEmail: "", reason: "" });
  const [goodFaith, setGoodFaith] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fields = fieldErrors(error);
  const general = error instanceof ApiError && Object.keys(fields).length === 0 ? error.message : error ? "We couldn't send that. Please try again." : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api("/takedowns", { method: "POST", body: { ...v, goodFaith } });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <Card className="mt-10 p-6" data-testid="dmca-done">
        <p role="status" className="font-medium">
          Thank you. We received your notice and will review it.
        </p>
      </Card>
    );
  }

  const input = "min-h-11 w-full rounded-key border border-line bg-surface-0 px-3 text-text aria-[invalid=true]:border-danger";
  const field = (name: keyof typeof v, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1">
      <label htmlFor={`${id}-${name}`} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={`${id}-${name}`}
        name={name}
        required
        {...props}
        value={v[name]}
        onChange={(e) => setV({ ...v, [name]: e.target.value })}
        aria-invalid={fields[name] ? true : undefined}
        className={input}
      />
      {fields[name] && <p className="text-sm text-danger">{fields[name]}</p>}
    </div>
  );

  return (
    <Card className="mt-10 p-6">
      <form onSubmit={submit} className="space-y-4" aria-label="Copyright takedown notice" data-testid="dmca-form">
        <h2 className="font-display text-2xl">Submit a notice</h2>
        {field("sourceUrl", "Link to the content", { type: "url", inputMode: "url", placeholder: "https://…" })}
        {field("requesterName", "Your name", { autoComplete: "name" })}
        {field("requesterEmail", "Your email", { type: "email", autoComplete: "email" })}
        <div className="space-y-1">
          <label htmlFor={`${id}-reason`} className="text-sm font-medium">
            The work and your right to act for its owner
          </label>
          <textarea
            id={`${id}-reason`}
            name="reason"
            required
            rows={5}
            minLength={20}
            maxLength={1000}
            value={v.reason}
            onChange={(e) => setV({ ...v, reason: e.target.value })}
            aria-invalid={fields.reason ? true : undefined}
            className={`${input} py-2`}
          />
          {fields.reason && <p className="text-sm text-danger">{fields.reason}</p>}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={goodFaith} onChange={(e) => setGoodFaith(e.target.checked)} />
          <span>I state in good faith that this use is not authorised by the rights owner, and that the information above is accurate.</span>
        </label>
        {fields.goodFaith && <p className="text-sm text-danger">{fields.goodFaith}</p>}
        {general && (
          <p role="alert" className="text-sm text-danger">
            {general}
          </p>
        )}
        <Button type="submit" disabled={pending || !goodFaith}>
          {pending ? "Sending…" : "Send notice"}
        </Button>
      </form>
    </Card>
  );
}
