"use client";

import { useId, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";

// The Candidates toolbar: Add a candidate first, then the rest in one row. The
// add form opens under the whole row and pushes the list down, so the person
// just added appears below it rather than behind it. It is hidden, not
// removed, when closed, so a half-typed entry survives. A read-only view,
// whose button the page disables, shows the fields open and disabled, so what
// cannot be done reads as refused rather than missing.
export function AddCandidateToolbar({ form, readOnly = false, children }: { form: ReactNode; readOnly?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(readOnly);
  const panelId = useId();
  return (
    <>
      <div className="role-toolbar">
        <button type="button" className="btn-primary" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
          <Icon name={open ? "close" : "plus"} size={16} />
          Add a candidate
        </button>
        {children}
      </div>
      <div id={panelId} hidden={!open} className="add-candidate-panel">{form}</div>
    </>
  );
}
