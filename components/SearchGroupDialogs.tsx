"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { Icon } from "@/components/Icon";
import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmActionButton, RowDialog } from "@/components/CandidateDialogs";
import { deleteSearchGroup, renameSearchGroup } from "@/app/actions/searches";
import { EMPTY_FORM_STATE } from "@/lib/formState";

// A group heading's pencil and bin, in the same dialogs as a candidate's row.
export function SearchGroupActions({ group, count }: { group: string; count: number }) {
  return (
    <>
      <RenameGroupButton group={group} />
      <ConfirmActionButton
        action={deleteSearchGroup}
        fields={{ group }}
        title={`Delete the group ${group}?`}
        body={`Its ${count === 1 ? "search stays" : `${count} searches stay`} in your library, under Ungrouped. Only the group goes.`}
        pendingLabel="Deleting…"
        className="row-icon-button is-danger"
        label={`Delete group ${group}`}
        tip="Delete group"
      >
        <Icon name="trash" size={15} />
      </ConfirmActionButton>
    </>
  );
}

function RenameGroupButton({ group }: { group: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(renameSearchGroup, EMPTY_FORM_STATE);
  const handled = useRef(state);
  const titleId = useId();
  const inputId = useId();

  // A rename that went through closes the dialog; the page then shows the new name.
  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    if (state.notice && !state.error) setOpen(false);
  }, [state]);

  return (
    <>
      <button
        type="button"
        className="row-icon-button hover-tip"
        aria-label={`Rename group ${group}`}
        data-tip="Rename group"
        onClick={() => setOpen(true)}
      >
        <Icon name="pencil" size={15} />
      </button>
      <RowDialog open={open} onClose={() => setOpen(false)} titleId={titleId}>
        <h2 id={titleId} className="row-dialog-title">Rename group</h2>
        <form action={formAction} className="row-dialog-fields">
          {state.error && (
            <p role="alert" data-form-message="error" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{state.error}</p>
          )}
          <input type="hidden" name="group" value={group} />
          <div>
            <label htmlFor={inputId} className="field-label">Group name</label>
            <input id={inputId} name="name" defaultValue={group} required autoFocus className="field-input" />
          </div>
          <p className="text-sm text-ink-soft">Every search in it moves to the new name. A name another group already has joins the two.</p>
          <div className="row-dialog-actions">
            <button type="button" className="btn-quiet" onClick={() => setOpen(false)}>Cancel</button>
            <SubmitButton pendingLabel="Saving…" className="btn-primary">Save</SubmitButton>
          </div>
        </form>
      </RowDialog>
    </>
  );
}
