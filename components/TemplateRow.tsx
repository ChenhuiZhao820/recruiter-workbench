"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFormState } from "react-dom";
import { Icon } from "@/components/Icon";
import { ConfirmActionButton, RowDialog } from "@/components/CandidateDialogs";
import { MessageBodyField } from "@/components/MessageBodyField";
import { SubmitButton } from "@/components/SubmitButton";
import { deleteTemplate, updateTemplate } from "@/app/actions/templates";
import { EMPTY_FORM_STATE } from "@/lib/formState";

// One template in the library, laid out like a candidate's row: its name with a
// pencil (edit, in a dialog) and a bin (asks first, in a dialog) beside it, and
// the message itself behind the chevron. The highlighted body is rendered on
// the server and handed in.
export function TemplateRow({ id, name, kind, kindLabel, body, children }: { id: string; name: string; kind: string; kindLabel: string; body: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [state, formAction] = useFormState(updateTemplate, EMPTY_FORM_STATE);
  const handled = useRef(state);
  const titleId = useId();
  const formId = useId();
  const panelId = useId();

  // A save that went through closes the dialog and says so on the row.
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
    const timer = setTimeout(() => setSaved(null), 5000);
    return () => clearTimeout(timer);
  }, [saved]);

  return (
    <div className="template-row">
      <div className="template-row-head">
        <div className="candidate-row-title">
          <span className="person-row-name">{name}</span>
          <span className="chip">{kindLabel}</span>
          <button type="button" className="row-icon-button hover-tip" aria-label={`Edit ${name}`} data-tip="Edit template" onClick={() => setEditing(true)}>
            <Icon name="pencil" size={15} />
          </button>
          <ConfirmActionButton
            action={deleteTemplate}
            fields={{ id }}
            title={`Delete ${name}?`}
            body="The template goes from your library. Messages already sent from it stay in their history. This cannot be undone."
            pendingLabel="Deleting…"
            className="row-icon-button is-danger"
            label={`Delete ${name}`}
            tip="Delete template"
          >
            <Icon name="trash" size={15} />
          </ConfirmActionButton>
          {saved && (
            <span role="status" className="row-saved">
              <Icon name="check" size={12} />
              {saved}
            </span>
          )}
        </div>
        <button type="button" className="template-row-toggle" aria-expanded={open} aria-controls={panelId} aria-label={open ? `Hide ${name}` : `Show ${name}`} onClick={() => setOpen(!open)}>
          <Icon name="down" size={18} className={open ? "rotate-180 text-accent" : "text-ink/60"} />
        </button>
      </div>
      {open && (
        <div id={panelId} className="template-row-body">
          <p className="font-mono text-xs tabular text-ink-soft">{body.length} chars</p>
          {children}
        </div>
      )}
      <RowDialog open={editing} onClose={() => setEditing(false)} titleId={titleId}>
        <div>
          <h2 id={titleId} className="row-dialog-title">Edit template</h2>
          <p className="text-sm text-ink-soft">{name}</p>
        </div>
        <form id={formId} action={formAction} className="row-dialog-fields">
          {state.error && <p role="alert" data-form-message="error" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{state.error}</p>}
          <input type="hidden" name="id" value={id} />
          <div>
            <label htmlFor={`tname-${id}`} className="field-label">Name</label>
            <input id={`tname-${id}`} name="name" defaultValue={name} required className="field-input" />
          </div>
          <MessageBodyField idPrefix={`t-${id}`} defaultKind={kind} defaultBody={body} />
          <div className="row-dialog-actions">
            <button type="button" className="btn-quiet" onClick={() => setEditing(false)}>Cancel</button>
            <SubmitButton pendingLabel="Saving…" className="btn-primary">Save template</SubmitButton>
          </div>
        </form>
      </RowDialog>
    </div>
  );
}
