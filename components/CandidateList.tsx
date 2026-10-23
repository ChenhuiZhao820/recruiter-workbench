"use client";

import { useDeferredValue, useId, useMemo, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { compareNames, nameMatches } from "@/lib/name-match.mjs";

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

// The role's candidates as one list, found by name and put in the order asked
// for (A to Z to begin with). Rows are rendered on the server; this only
// chooses which show and in what order, and writes nothing.
export function CandidateList({ rows }: { rows: CandidateListRow[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortId>("az");
  const typed = useDeferredValue(query);
  const searchId = useId();
  const sortId = useId();

  const shown = useMemo(() => rows.filter((row) => nameMatches(typed, row.name)).sort(SORTS[sort].compare), [rows, typed, sort]);
  const filtering = typed.trim().length > 0;

  return (
    <div className="candidate-list">
      <div className="candidate-tools" role="search" aria-label="Candidates on this role">
        <div className="candidate-search">
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
        <div className="candidate-sort">
          <Icon name="sort" size={16} />
          <label htmlFor={sortId} className="sr-only">Sort candidates</label>
          <select id={sortId} value={sort} onChange={(event) => setSort(event.target.value as SortId)}>
            {Object.entries(SORTS).map(([id, option]) => <option key={id} value={id}>{option.label}</option>)}
          </select>
          <Icon name="down" size={14} />
        </div>
        <p role="status" aria-live="polite" className="candidate-tools-count">
          {filtering ? `${shown.length} of ${rows.length}` : ""}
        </p>
      </div>

      {filtering && shown.length === 0 && (
        <p className="candidate-none">No one on this role matches &ldquo;{typed.trim()}&rdquo;.</p>
      )}

      <ul className="candidate-rows">
        {shown.map((row) => <li key={row.id} id={`candidate-${row.id}`} className="card candidate-row">{row.node}</li>)}
      </ul>
    </div>
  );
}
