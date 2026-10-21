"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GIVE_UP_MS, POLL_MS, remainingText } from "@/lib/email-finder-timing.mjs";

// One person's work email, found through Enrow on a click. By their LinkedIn
// address when there is one; otherwise, or when that finds nothing, by their
// name and a company the recruiter confirms first, never one guessed and sent
// unseen. The search runs on this app's server, which asks Enrow and writes a
// found email onto the person; this component only starts it and asks how it
// is going. It searches once per click and never on its own.
export function FindEmail({
  personId,
  name,
  hasLinkedIn,
  companyGuess,
  allowance,
  compact = false,
  onFound,
}: {
  personId: string;
  name: string;
  hasLinkedIn: boolean;
  companyGuess: string | null;
  allowance: { remaining: number; quota: number; trial: boolean };
  compact?: boolean;
  onFound?: (email: string) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "company" | "searching" | "found" | "missed" | "failed">(hasLinkedIn ? "idle" : "company");
  const [company, setCompany] = useState(companyGuess ?? "");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [remaining, setRemaining] = useState(allowance.remaining);
  const [open, setOpen] = useState(!compact);
  const cancelled = useRef(false);
  // Set again on every mount: React mounts twice in development, and a flag
  // left from the first unmount would stop every search from being read.
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const left = remainingText({ remaining, quota: allowance.quota, trial: allowance.trial });
  const usedUp = remaining <= 0;

  async function search(byCompany: string | null) {
    setState("searching");
    setMessage("");
    try {
      const response = await fetch("/api/email-finder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(byCompany === null ? { personId } : { personId, company: byCompany }),
      });
      const started = (await response.json().catch(() => ({}))) as { id?: string; remaining?: number; error?: string; needCompany?: boolean };
      if (typeof started.remaining === "number") setRemaining(started.remaining);
      if (!response.ok || !started.id) {
        setMessage(started.error ?? "The search could not start. Try again in a moment.");
        setState(started.needCompany ? "company" : "failed");
        return;
      }
      const until = Date.now() + GIVE_UP_MS + POLL_MS;
      while (!cancelled.current && Date.now() < until) {
        await new Promise((done) => setTimeout(done, POLL_MS));
        const polled = await fetch(`/api/email-finder/${encodeURIComponent(started.id)}`, { cache: "no-store" });
        const result = (await polled.json().catch(() => ({}))) as { status?: string; email?: string | null; text?: string; remaining?: number; error?: string };
        if (typeof result.remaining === "number") setRemaining(result.remaining);
        if (!polled.ok) {
          setMessage(result.error ?? "The search did not finish. Try again in a moment.");
          setState("failed");
          return;
        }
        if (result.status === "pending") continue;
        if (result.status === "found" && result.email) {
          setEmail(result.email);
          setState("found");
          onFound?.(result.email);
          router.refresh();
          return;
        }
        setMessage(result.text ?? "No email found.");
        setState(result.status === "not_found" ? "missed" : "failed");
        return;
      }
      if (!cancelled.current) {
        setMessage("The search is taking too long. Try again in a moment.");
        setState("failed");
      }
    } catch {
      setMessage("The search could not be reached. Try again in a moment.");
      setState("failed");
    }
  }

  if (state === "found") {
    return (
      <p role="status" className="email-finder-result">
        Found <a href={`mailto:${email}`} className="font-medium underline">{email}</a>
        <span className="chip">Unverified</span>
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn-quiet"
        onClick={() => {
          setOpen(true);
          if (hasLinkedIn) void search(null);
        }}
        disabled={usedUp}
        title={left}
      >
        Find email
      </button>
    );
  }

  const companyField = (
    <form
      className="email-finder-company"
      onSubmit={(event) => {
        event.preventDefault();
        if (company.trim()) void search(company.trim());
      }}
    >
      <label htmlFor={`find-email-company-${personId}`} className="field-label">Where {name} works now</label>
      <div className="email-finder-row">
        <input
          id={`find-email-company-${personId}`}
          value={company}
          onChange={(event) => setCompany(event.target.value)}
          className="field-input"
          placeholder="Company name"
          maxLength={120}
          required
        />
        <button type="submit" className="btn-secondary" disabled={usedUp || !company.trim()}>Search by name</button>
      </div>
    </form>
  );

  return (
    <div className="email-finder" aria-busy={state === "searching"}>
      {state === "idle" && (
        <button type="button" className="btn-secondary" onClick={() => void search(null)} disabled={usedUp}>
          Find email
        </button>
      )}
      {(state === "company" || state === "missed" || (state === "failed" && !hasLinkedIn)) && companyField}
      {state === "failed" && hasLinkedIn && (
        <button type="button" className="btn-secondary" onClick={() => void search(null)} disabled={usedUp}>
          Try again
        </button>
      )}
      <p role="status" aria-live="polite" className="text-sm text-ink-soft">
        {state === "searching"
          ? `Looking for ${name}'s work email...`
          : message
            ? message
            : state === "company"
              ? `Search by ${name}'s name and the company they work for.`
              : ""}
      </p>
      <p className="text-xs text-ink-soft">
        {usedUp ? `${left}.` : `${left}. A search that finds nothing is free.`}
      </p>
    </div>
  );
}
