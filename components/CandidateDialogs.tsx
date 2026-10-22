"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFormState } from "react-dom";
import { Icon } from "@/components/Icon";
import { FindEmail } from "@/components/FindEmail";
import { SubmitButton } from "@/components/SubmitButton";
import { deleteCandidate, updateCandidate } from "@/app/actions/candidates";
import { EMPTY_FORM_STATE } from "@/lib/formState";

// The row's own dialogs: a modal over a blurred page, opened from an icon on
// the candidate's row. They sit in a portal outside the row, so a form in one
// never nests inside another form on the page.
function RowDialog({ open, onClose, titleId, children }: { open: boolean; onClose: () => void; titleId: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  if (!mounted) return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="row-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      // A press on the blurred backdrop lands on the dialog element itself.
      onMouseDown={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      {open && <div className="row-dialog-body">{children}</div>}
    </dialog>,
    document.body,
  );
}

type Details = { fullName: string; profileUrl: string; headline: string; notes: string; email: string };

export function EditCandidateButton({
  candidateId,
  details,
  finder,
}: {
  candidateId: string;
  details: Details;
  // The email finder, when this account has it and this person may be
  // searched for. Absent, the field is a plain email field.
  finder?: { personId: string; name: string; hasLinkedIn: boolean; companyGuess: string | null; allowance: { remaining: number; quota: number; trial: boolean } } | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(updateCandidate, EMPTY_FORM_STATE);
  const [email, setEmail] = useState(details.email);
  const [saved, setSaved] = useState(false);
  const handled = useRef(state);
  // A found email is already on their record, so it is not a change to save.
  const found = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const formId = useId();

  // A save that went through closes the dialog and says so on the row.
  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    if (state.notice && !state.error) {
      setOpen(false);
      setSaved(true);
    }
  }, [state]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(timer);
  }, [saved]);

  function close() {
    setOpen(false);
    setEmail(details.email);
  }

  const field = (key: keyof Details, label: string, input: ReactNode) => (
    <div>
      <label htmlFor={`${formId}-${key}`} className="field-label">{label}</label>
      {input}
    </div>
  );

  return (
    <>
      <button
        type="button"
        className="row-icon-button hover-tip"
        aria-label={`Edit details for ${details.fullName}`}
        data-tip="Edit details"
        onClick={() => {
          setEmail(details.email);
          setOpen(true);
        }}
      >
        <Icon name="pencil" size={15} />
      </button>
      {saved && (
        <span role="status" className="row-saved">
          <Icon name="check" size={12} />
          Changes saved
        </span>
      )}
      <RowDialog open={open} onClose={close} titleId={titleId}>
        <div>
          <h2 id={titleId} className="row-dialog-title">Edit details</h2>
          <p className="text-sm text-ink-soft">{details.fullName}</p>
        </div>
        <form
          ref={form}
          id={formId}
          action={formAction}
          className="row-dialog-fields"
          onSubmit={(event) => {
            // Nothing changed is nothing to save, and nothing to announce.
            const now = new FormData(event.currentTarget);
            const was = { ...details, email: found.current ?? details.email };
            const same = (Object.keys(was) as (keyof Details)[]).every((key) => String(now.get(key) ?? "").trim() === was[key].trim());
            if (same) {
              event.preventDefault();
              close();
            }
          }}
        >
          {state.error && (
            <p role="alert" data-form-message="error" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{state.error}</p>
          )}
          <input type="hidden" name="id" value={candidateId} />
          <input type="hidden" name="emailWas" value={details.email} />
          {field("fullName", "Full name", <input id={`${formId}-fullName`} name="fullName" defaultValue={details.fullName} required className="field-input" />)}
          {field("profileUrl", "Profile link", <input id={`${formId}-profileUrl`} name="profileUrl" defaultValue={details.profileUrl} className="field-input" placeholder="https://www.linkedin.com/in/..." />)}
          {field("headline", "Headline", <input id={`${formId}-headline`} name="headline" defaultValue={details.headline} className="field-input" />)}
        </form>
        {/* Outside the form element, joined to it by `form`: the finder may
            ask for a company in a small form of its own. */}
        <div>
          <label htmlFor={`${formId}-email`} className="field-label">Email</label>
          <div className="row-dialog-email">
            <input
              id={`${formId}-email`}
              form={formId}
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="field-input"
              placeholder="name@company.com"
              autoComplete="off"
            />
            {finder && (
              <FindEmail
                {...finder}
                inline
                blocked={details.email ? `${finder.name} already has an email saved.` : undefined}
                onFound={(address) => {
                  found.current = address;
                  setEmail(address);
                }}
              />
            )}
          </div>
        </div>
        {field("notes", "Notes", <textarea id={`${formId}-notes`} form={formId} name="notes" defaultValue={details.notes} rows={3} className="field-input" />)}
        <div className="row-dialog-actions">
          <button type="button" className="btn-quiet" onClick={close}>Cancel</button>
          <button type="submit" form={formId} className="btn-primary">Save</button>
        </div>
      </RowDialog>
    </>
  );
}

// A button that asks first, in the same kind of dialog: Confirm submits the
// action with its fields, Cancel leaves everything as it was.
export function ConfirmActionButton({
  action,
  fields,
  title,
  body,
  pendingLabel,
  className,
  label,
  tip,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  title: string;
  body: string;
  pendingLabel: string;
  className: string;
  label: string;
  // Shown on hover when the button is an icon, whose name `label` then is.
  tip?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  return (
    <>
      <button
        type="button"
        className={tip ? `${className} hover-tip` : className}
        aria-label={label}
        data-tip={tip}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      <RowDialog open={open} onClose={() => setOpen(false)} titleId={titleId}>
        <form action={action} className="row-dialog-confirm">
          {Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
          <h2 id={titleId} className="row-dialog-title">{title}</h2>
          <p className="text-sm text-ink-soft">{body}</p>
          <div className="row-dialog-actions">
            <button type="button" className="btn-quiet" onClick={() => setOpen(false)}>Cancel</button>
            <SubmitButton pendingLabel={pendingLabel} className="btn-danger">Confirm</SubmitButton>
          </div>
        </form>
      </RowDialog>
    </>
  );
}

export function RemoveCandidateButton({ candidateId, name }: { candidateId: string; name: string }) {
  return (
    <ConfirmActionButton
      action={deleteCandidate}
      fields={{ id: candidateId }}
      title={`Remove ${name}?`}
      body="They come off this role, with their outreach history on it. This cannot be undone."
      pendingLabel="Removing…"
      className="row-icon-button is-danger"
      label={`Remove ${name}`}
      tip="Remove from this role"
    >
      <Icon name="trash" size={15} />
    </ConfirmActionButton>
  );
}
