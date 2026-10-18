"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { deleteShortlists } from "@/app/actions/custom-shortlists";
import { EMPTY_FORM_STATE } from "@/lib/formState";

// The bar above closed and expired shortlists: select all, and delete what is
// ticked. The row checkboxes live beside each row and join this form through
// their `form` attribute, so the rows keep their own forms inside them.
export function BulkDeleteShortlists({ formId }: { formId: string }) {
  const [state, formAction] = useFormState(deleteShortlists, EMPTY_FORM_STATE);
  const [selected, setSelected] = useState(0);
  const [total, setTotal] = useState(0);
  const all = useRef<HTMLInputElement>(null);

  const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${formId}"][name="id"]`));
  const recount = () => {
    const list = boxes();
    const ticked = list.filter((box) => box.checked).length;
    setSelected(ticked);
    setTotal(list.length);
    if (all.current) {
      all.current.checked = list.length > 0 && ticked === list.length;
      all.current.indeterminate = ticked > 0 && ticked < list.length;
    }
  };

  useEffect(() => {
    recount();
    const onChange = (event: Event) => {
      const target = event.target as HTMLInputElement | null;
      if (target?.getAttribute("form") === formId) recount();
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
    // Rows deleted by the action leave the page with the same response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, state]);

  return (
    <form
      id={formId}
      action={formAction}
      className="bulk-bar"
      onSubmit={(event) => {
        const n = boxes().filter((box) => box.checked).length;
        if (!n || !window.confirm(`Delete ${n === 1 ? "this shortlist" : `${n} shortlists`} for good? ${n === 1 ? "Its link and the client's answers on it are" : "Their links and the clients' answers on them are"} removed. The people stay in People.`)) event.preventDefault();
      }}
    >
      <label className="bulk-bar-all">
        <input ref={all} type="checkbox" disabled={!total} onChange={(event) => { for (const box of boxes()) box.checked = event.target.checked; recount(); }} />
        <span>Select all</span>
      </label>
      <button type="submit" className="btn-quiet btn-danger-quiet" disabled={!selected}>
        {selected ? `Delete ${selected} selected` : "Delete selected"}
      </button>
      {state.error && <p role="alert" className="bulk-bar-message is-error">{state.error}</p>}
      {state.notice && <p role="status" className="bulk-bar-message">{state.notice}</p>}
    </form>
  );
}
