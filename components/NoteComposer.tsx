"use client";

import { useEffect, useRef } from "react";
import { useFormState } from "react-dom";
import { addPersonNote } from "@/app/actions/notes";
import { EMPTY_FORM_STATE } from "@/lib/formState";
import { SubmitButton } from "@/components/SubmitButton";

// Writing a note on a person's page. Once it is saved the box empties, so the
// same note is not saved twice by a second click.
export function NoteComposer({ personId, firstName }: { personId: string; firstName: string }) {
  const [state, action] = useFormState(addPersonNote, EMPTY_FORM_STATE);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.notice && !state.error) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={action} className="space-y-3">
      <input type="hidden" name="personId" value={personId} />
      {state.error && (
        <p role="alert" data-form-message="error" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {state.error}
        </p>
      )}
      {state.notice && !state.error && (
        <p role="status" data-form-message="notice" className="rounded border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-ink">
          {state.notice}
        </p>
      )}
      <label htmlFor="note-body" className="field-label">New note</label>
      <textarea id="note-body" name="body" rows={3} className="field-input" placeholder={`What you want to remember about ${firstName}.`} />
      <SubmitButton className="btn-secondary" pendingLabel="Saving...">Save note</SubmitButton>
    </form>
  );
}
