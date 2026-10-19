"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { uploadCv } from "@/app/actions/cv";
import { EMPTY_FORM_STATE } from "@/lib/formState";
import { CONTACTS_CHECK, CONTACTS_NOTICE } from "@/lib/cv-core.mjs";

function UploadButton({ ready, label }: { ready: boolean; label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn-primary" disabled={!ready || pending}>{pending ? "Uploading…" : label}</button>;
}

// Uploading a CV. The notice about contact details sits between the file and
// the button, and the button stays off until its box is ticked: the client
// sees the PDF exactly as it is, and that is not something to click past. The
// server refuses an upload without the tick too.
export function CvUpload({ personId, candidateId, idPrefix = "cv", label = "Upload CV", onUploaded }: {
  personId?: string;
  candidateId?: string;
  idPrefix?: string;
  label?: string;
  onUploaded?: () => void;
}) {
  const [state, action] = useFormState(uploadCv, EMPTY_FORM_STATE);
  const [hasFile, setHasFile] = useState(false);
  const [checked, setChecked] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const notified = useRef<typeof state | null>(null);

  useEffect(() => {
    if (state.notice && notified.current !== state) {
      notified.current = state;
      form.current?.reset();
      setHasFile(false);
      setChecked(false);
      onUploaded?.();
    }
  }, [state, onUploaded]);

  return (
    <form ref={form} action={action} className="cv-upload">
      {personId && <input type="hidden" name="personId" value={personId} />}
      {candidateId && <input type="hidden" name="candidateId" value={candidateId} />}
      <div>
        <label htmlFor={`${idPrefix}-file`} className="field-label">CV (PDF, up to 4 MB)</label>
        <input id={`${idPrefix}-file`} name="cv" type="file" accept="application/pdf,.pdf" required className="field-input" onChange={(event) => setHasFile(Boolean(event.target.files?.length))} />
      </div>
      <div className="cv-contacts" role="note">
        <p>{CONTACTS_NOTICE}</p>
        <label htmlFor={`${idPrefix}-contacts`}>
          <input id={`${idPrefix}-contacts`} name="contactsChecked" type="checkbox" required checked={checked} onChange={(event) => setChecked(event.target.checked)} />
          <span>{CONTACTS_CHECK}</span>
        </label>
      </div>
      {state.error && <p role="alert" data-form-message="error" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{state.error}</p>}
      {state.notice && <p role="status" data-form-message="notice" className="text-sm text-ink-soft">{state.notice}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <UploadButton ready={hasFile && checked} label={label} />
        {!checked && hasFile && <span className="text-xs text-ink-soft">Tick the box above to upload.</span>}
      </div>
    </form>
  );
}
