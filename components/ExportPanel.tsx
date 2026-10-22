"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";

// The ids match EXPORT_TABLES in lib/export.ts, which the route checks again.
const TABLES = [
  { id: "people", label: "People" },
  { id: "notes", label: "Notes" },
  { id: "candidates", label: "Candidates" },
  { id: "roles", label: "Roles" },
  { id: "screenings", label: "Screenings" },
  { id: "bookings", label: "Bookings" },
  { id: "outreach", label: "Messages" },
  { id: "templates", label: "Templates" },
  { id: "searches", label: "Searches" },
  { id: "shortlists", label: "Shortlists" },
  { id: "shortlistPeople", label: "Shortlist entries" },
  { id: "cvs", label: "CVs (list only)" },
] as const;

// Two choices first - everything, or some tables - and the tables only once
// asked for. The table form is a plain GET, so the download needs no script.
export function ExportPanel() {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const all = chosen.length === TABLES.length;
  const toggle = (id: string) => setChosen((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  return (
    <div className="export-panel">
      <div className="export-choices">
        <a href="/api/export?format=json" download className="export-choice">
          <span className="min-w-0">
            <span className="export-choice-title">Export everything</span>
            <span className="export-choice-text">One JSON file with all your records.</span>
          </span>
          <Icon name="download" size={18} />
        </a>
        <button type="button" className="export-choice" aria-expanded={open} aria-controls="export-tables" onClick={() => setOpen((value) => !value)}>
          <span className="min-w-0">
            <span className="export-choice-title">Export tables</span>
            <span className="export-choice-text">Spreadsheets (CSV) of the tables you choose.</span>
          </span>
          <Icon name="down" size={18} className="export-choice-chevron" />
        </button>
      </div>
      {open && (
        <form id="export-tables" className="export-tables" method="get" action="/api/export">
          <input type="hidden" name="format" value="csv" />
          <div className="export-tables-head">
            <p id="export-tables-label" className="settings-label">Choose tables</p>
            <button type="button" className="settings-link-button" onClick={() => setChosen(all ? [] : TABLES.map((table) => table.id))}>
              {all ? "Clear all" : "Select all"}
            </button>
          </div>
          <ul className="export-table-list" role="group" aria-labelledby="export-tables-label">
            {TABLES.map((table) => (
              <li key={table.id}>
                <label className="export-table">
                  <input type="checkbox" name="table" value={table.id} checked={chosen.includes(table.id)} onChange={() => toggle(table.id)} />
                  {table.label}
                </label>
              </li>
            ))}
          </ul>
          <div className="export-tables-foot">
            <button type="submit" className="btn-primary" disabled={chosen.length === 0}>
              {chosen.length === 0 ? "Download" : `Download ${chosen.length} ${chosen.length === 1 ? "table" : "tables"}`}
              <Icon name="download" size={16} />
            </button>
            <p className="settings-hint">
              {chosen.length === 0
                ? "Tick at least one table."
                : chosen.length === 1 ? "One CSV file, for Excel or Google Sheets." : "One ZIP with a CSV file for each table."}
            </p>
          </div>
        </form>
      )}
    </div>
  );
}
