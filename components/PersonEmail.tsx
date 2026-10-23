"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { Icon } from "@/components/Icon";
import { ConfirmActionButton, RowDialog } from "@/components/CandidateDialogs";
import { SubmitButton } from "@/components/SubmitButton";
import { removePersonEmail, setPersonEmail } from "@/app/actions/people";
import { GIVE_UP_MS, POLL_MS, remainingText } from "@/lib/email-finder-timing.mjs";
import { EMPTY_FORM_STATE } from "@/lib/formState";

type Allowance = { remaining: number; quota: number; trial: boolean };

// The address kept for one person, on their page; with none, what finds one
// (given as children) and a way to add it by hand. A pencil edits it in place
// and a bin removes it once the recruiter has confirmed in a dialog. An address
// Enrow found also offers "I believe this is the wrong email": a dialog that
// takes the name and company and searches Enrow again by them, on that click
// only. Nothing is sent to us about it; the notice there is only a notice.
export function PersonEmail({
  personId,
  email,
  fullName,
  companyGuess,
  recheck,
  children,
}: {
  personId: string;
  email: string | null;
  fullName: string;
  companyGuess: string | null;
  // Present when this address was found by Enrow and the plan can search again.
  recheck: Allowance | null;
  children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState("");
  const [wrong, setWrong] = useState(false);
  const [state, formAction] = useFormState(setPersonEmail, EMPTY_FORM_STATE);
  const handled = useRef(state);
  const wrongTitle = useId();

  // A save that went through closes the editor and says so beside the address.
  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    if (state.notice && !state.error) {
      setEditing(false);
      setSaved(state.notice);
    }
  }, [state]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(""), 5000);
    return () => clearTimeout(timer);
  }, [saved]);

  if (!email) {
    return (
      <div className="person-email-block">
        {children}
        <details>
          <summary className="cursor-pointer text-sm text-ink/70">Add it by hand</summary>
          <form action={formAction} className="mt-2 space-y-2">
            <input type="hidden" name="id" value={personId} />
            <label htmlFor={`person-email-${personId}`} className="field-label">Email address</label>
            <input id={`person-email-${personId}`} name="email" type="email" autoComplete="off" className="field-input" />
            <SubmitButton className="btn-secondary" pendingLabel="Saving...">Save email</SubmitButton>
            {state.error && <p role="alert" data-form-message="error" className="finder-note is-missed">{state.error}</p>}
          </form>
        </details>
      </div>
    );
  }

  return (
    <div className="person-email-block">
      {editing ? (
        <form action={formAction} className="person-email-edit">
          <input type="hidden" name="id" value={personId} />
          <label htmlFor={`person-email-${personId}`} className="sr-only">Email address</label>
          <input id={`person-email-${personId}`} name="email" type="email" defaultValue={email} autoComplete="off" autoFocus required className="field-input" />
          <div className="person-email-edit-actions">
            <SubmitButton className="btn-secondary" pendingLabel="Saving...">Save email</SubmitButton>
            <button type="button" className="btn-quiet" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          {state.error && <p role="alert" data-form-message="error" className="finder-note is-missed">{state.error}</p>}
        </form>
      ) : (
        <p className="person-email-address">
          <a href={`mailto:${email}`} className="font-medium underline">{email}</a>
          <button type="button" className="row-icon-button hover-tip" aria-label="Edit email" data-tip="Edit email" onClick={() => { setSaved(""); setEditing(true); }}>
            <Icon name="pencil" size={15} />
          </button>
          <ConfirmActionButton
            action={removePersonEmail}
            fields={{ id: personId }}
            title="Remove this email?"
            body={`${email} is taken off this person. You can add or search for another one afterwards.`}
            pendingLabel="Removing…"
            className="row-icon-button is-danger"
            label="Remove email"
            tip="Remove email"
          >
            <Icon name="trash" size={15} />
          </ConfirmActionButton>
          {saved && (
            <span role="status" className="row-saved">
              <Icon name="check" size={12} />
              {saved}
            </span>
          )}
        </p>
      )}
      {recheck && !editing && (
        <>
          <button type="button" className="wrong-email-link" onClick={() => setWrong(true)}>
            <Icon name="flag" size={14} />
            I believe this is the wrong email
          </button>
          <RowDialog open={wrong} onClose={() => setWrong(false)} titleId={wrongTitle}>
            <WrongEmailForm
              titleId={wrongTitle}
              personId={personId}
              email={email}
              fullName={fullName}
              companyGuess={companyGuess}
              allowance={recheck}
              onClose={() => setWrong(false)}
            />
          </RowDialog>
        </>
      )}
    </div>
  );
}

function WrongEmailForm({
  titleId,
  personId,
  email,
  fullName,
  companyGuess,
  allowance,
  onClose,
}: {
  titleId: string;
  personId: string;
  email: string;
  fullName: string;
  companyGuess: string | null;
  allowance: Allowance;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(fullName);
  const [company, setCompany] = useState(companyGuess ?? "");
  const [state, setState] = useState<"idle" | "searching" | "found" | "missed" | "failed">("idle");
  const [message, setMessage] = useState("");
  const [remaining, setRemaining] = useState(allowance.remaining);
  const cancelled = useRef(false);
  // Set again on every mount: React mounts twice in development.
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const usedUp = remaining <= 0;
  const left = remainingText({ remaining, quota: allowance.quota, trial: allowance.trial });
  const ready = name.trim().split(/\s+/).length >= 2 && company.trim() !== "";

  async function search() {
    setState("searching");
    setMessage("");
    try {
      const response = await fetch("/api/email-finder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personId, recheck: true, name: name.trim(), company: company.trim() }),
      });
      const started = (await response.json().catch(() => ({}))) as { id?: string; remaining?: number; error?: string };
      if (typeof started.remaining === "number") setRemaining(started.remaining);
      if (!response.ok || !started.id) {
        setMessage(started.error ?? "The search could not start. Try again in a moment.");
        setState("failed");
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
          setMessage(result.email.toLowerCase() === email.toLowerCase() ? `Enrow found the same address again: ${result.email}.` : `Found ${result.email}. It has replaced the old address.`);
          setState("found");
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

  return (
    <form
      className="wrong-email-form"
      aria-busy={state === "searching"}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !usedUp && state !== "searching" && state !== "found") void search();
      }}
    >
      <div>
        <h2 id={titleId} className="row-dialog-title">Thanks for telling us</h2>
        <p role="status" className="text-sm text-ink-soft">We have received your feedback that {email} may be the wrong address.</p>
      </div>
      <p className="text-sm">Check their name and where they work now, and we will search again by those.</p>
      <div>
        <label htmlFor={`wrong-name-${personId}`} className="field-label">Full name</label>
        <input id={`wrong-name-${personId}`} value={name} onChange={(event) => setName(event.target.value)} className="field-input" maxLength={120} autoComplete="off" required />
      </div>
      <div>
        <label htmlFor={`wrong-company-${personId}`} className="field-label">Company name</label>
        <input id={`wrong-company-${personId}`} value={company} onChange={(event) => setCompany(event.target.value)} className="field-input" placeholder="Where they work now" maxLength={120} autoComplete="off" required />
      </div>
      <p role="status" aria-live="polite" className={state === "found" ? "finder-note is-found" : state === "missed" || state === "failed" ? "finder-note is-missed" : "finder-note"}>
        {state === "searching" ? "Searching…" : state === "missed" ? "Email cannot be found. No credit was used." : state === "failed" ? `${message} No credit was used.` : message}
      </p>
      <p className="finder-note">{usedUp ? `${left}.` : `${left}. A search that finds nothing is free.`}</p>
      <div className="row-dialog-actions">
        <button type="button" className="btn-quiet" onClick={onClose}>{state === "found" ? "Done" : "Cancel"}</button>
        {state !== "found" && (
          <button type="submit" className="btn-primary" disabled={!ready || usedUp || state === "searching"}>
            {state === "searching" ? "Searching…" : "Search again"}
          </button>
        )}
      </div>
    </form>
  );
}
