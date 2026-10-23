"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";

type Panel = "add" | "import" | null;

// The Candidates toolbar: Add a candidate first, with a small menu beside it
// for importing a client's CSV, then the rest in one row. Either form opens
// under the whole row and pushes the list down, so the people just added
// appear below it rather than behind it. Both are hidden, not removed, when
// closed, so a half-typed entry survives. A read-only view, whose controls the
// page disables, shows the add fields open and disabled, so what cannot be
// done reads as refused rather than missing.
export function AddCandidateToolbar({ form, importForm, readOnly = false, children }: { form: ReactNode; importForm: ReactNode; readOnly?: boolean; children: ReactNode }) {
  const [panel, setPanel] = useState<Panel>(readOnly ? "add" : null);
  const [menu, setMenu] = useState(false);
  const addId = useId();
  const importId = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const away = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", escape); };
  }, [menu]);

  const toggle = (next: Exclude<Panel, null>) => { setPanel(panel === next ? null : next); setMenu(false); };

  return (
    <>
      <div className="role-toolbar">
        <div ref={root} className="split-button">
          <button type="button" className="btn-primary split-button-main" aria-expanded={panel === "add"} aria-controls={addId} onClick={() => toggle("add")}>
            <Icon name={panel === "add" ? "close" : "plus"} size={16} />
            Add a candidate
          </button>
          <button type="button" className="btn-primary split-button-more" aria-label="Import options" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Icon name="down" size={16} />
          </button>
          {menu && (
            <ul role="menu" className="split-button-menu">
              <li role="none"><button type="button" role="menuitem" onClick={() => toggle("add")}><Icon name="pencil" size={15} />Add one by hand</button></li>
              <li role="none"><button type="button" role="menuitem" onClick={() => toggle("import")}><Icon name="download" size={15} className="rotate-180" />Import from CSV</button></li>
            </ul>
          )}
        </div>
        {children}
      </div>
      <div id={addId} hidden={panel !== "add"} className="add-candidate-panel">{form}</div>
      <div id={importId} hidden={panel !== "import"} className="add-candidate-panel">{importForm}</div>
    </>
  );
}
