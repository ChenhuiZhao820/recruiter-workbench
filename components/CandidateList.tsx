"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { compareNames, nameMatches } from "@/lib/name-match.mjs";
import { useToolbarSlot } from "@/components/AddCandidateToolbar";

export type CandidateListRow = { id: string; name: string; stageRank: number; addedAt: string; activeAt: string; node: ReactNode };

type Compare = (a: CandidateListRow, b: CandidateListRow) => number;
const byName: Compare = (a, b) => compareNames(a.name, b.name);
const SORTS: Record<string, { label: string; compare: Compare }> = {
  az: { label: "A to Z", compare: byName },
  za: { label: "Z to A", compare: (a, b) => compareNames(b.name, a.name) },
  active: { label: "Recently active", compare: (a, b) => b.activeAt.localeCompare(a.activeAt) || byName(a, b) },
  added: { label: "Recently added", compare: (a, b) => b.addedAt.localeCompare(a.addedAt) || byName(a, b) },
  stage: { label: "By stage", compare: (a, b) => a.stageRank - b.stageRank || byName(a, b) },
};
type SortId = keyof typeof SORTS;

// The sort as a small menu of its own, in the page's type, in place of the
// browser's native list. Arrow keys move, Enter or a click picks, Esc closes.
function SortMenu({ id, value, onChange }: { id: string; value: SortId; onChange: (value: SortId) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const ids = Object.keys(SORTS);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>("[aria-selected='true']")?.focus();
    const away = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  function pick(next: string) {
    onChange(next);
    setOpen(false);
    root.current?.querySelector<HTMLElement>("button")?.focus();
  }
  function move(event: KeyboardEvent<HTMLUListElement>) {
    const options = Array.from(list.current?.querySelectorAll<HTMLElement>("[role='option']") ?? []);
    const at = options.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); root.current?.querySelector<HTMLElement>("button")?.focus(); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); options[(at + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus(); }
    else if (event.key === "Home" || event.key === "End") { event.preventDefault(); options[event.key === "Home" ? 0 : options.length - 1]?.focus(); }
    else if (event.key === "Tab") setOpen(false);
  }

  return (
    <div ref={root} className="sort-menu">
      <button id={id} type="button" className="sort-menu-button" aria-haspopup="listbox" aria-expanded={open} aria-label={`Sort candidates: ${SORTS[value].label}`} onClick={() => setOpen(!open)}>
        <Icon name="sort" size={16} />
        <span>{SORTS[value].label}</span>
        <Icon name="down" size={14} className="sort-menu-chevron" />
      </button>
      {open && (
        <ul ref={list} role="listbox" aria-label="Sort candidates" className="sort-menu-list" onKeyDown={move}>
          {ids.map((option) => (
            <li key={option} role="none">
              <button type="button" role="option" aria-selected={option === value} className="sort-menu-option" onClick={() => pick(option)}>
                {SORTS[option].label}
                {option === value && <Icon name="check" size={14} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The role's candidates as one list, found by name and put in the order asked
// for (A to Z to begin with). Rows are rendered on the server; this only
// chooses which show and in what order, and writes nothing.
export function CandidateList({ rows }: { rows: CandidateListRow[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortId>("az");
  const typed = useDeferredValue(query);
  const slot = useToolbarSlot();
  const searchId = useId();
  const sortId = useId();

  const shown = useMemo(() => rows.filter((row) => nameMatches(typed, row.name)).sort(SORTS[sort].compare), [rows, typed, sort]);
  const filtering = typed.trim().length > 0;

  return (
    <div className="candidate-list">
      <div className="candidate-tools" role={rows.length ? "search" : undefined} aria-label={rows.length ? "Candidates on this role" : undefined}>
        {rows.length > 0 && <><div className="candidate-search">
          <Icon name="search" size={16} />
          <label htmlFor={searchId} className="sr-only">Find a candidate by name</label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }}
            placeholder="Find by name"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button type="button" className="row-icon-button hover-tip" aria-label="Clear the search" data-tip="Clear" onClick={() => setQuery("")}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        <SortMenu id={sortId} value={sort} onChange={setSort} />
        <p role="status" aria-live="polite" className="candidate-tools-count">
          {filtering ? `${shown.length} of ${rows.length}` : ""}
        </p></>}
        {slot && <div className="candidate-tools-actions">{slot.actions}</div>}
      </div>
      {slot && <div className="role-toolbar">{slot.add}</div>}
      {slot?.panels}

      {rows.length === 0 && (
        <p className="mb-3 text-ink/70">
          No candidates yet. When you find someone on LinkedIn, paste their profile link and name above.
        </p>
      )}

      {filtering && shown.length === 0 && (
        <p className="candidate-none">No one on this role matches &ldquo;{typed.trim()}&rdquo;.</p>
      )}

      <ul className="candidate-rows">
        {shown.map((row) => <li key={row.id} id={`candidate-${row.id}`} className="card candidate-row">{row.node}</li>)}
      </ul>
    </div>
  );
}
