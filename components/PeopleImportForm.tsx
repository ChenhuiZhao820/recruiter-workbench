"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { previewPeopleImport, runPeopleImport, type ImportState } from "@/app/actions/people-import";
import type { ImportResult, Preview, PreviewRow } from "@/lib/people-import-server";
import { FIELD_LABELS, IMPORT_FIELDS } from "@/lib/people-import-fields.mjs";

const OUTCOME: Record<PreviewRow["status"], string> = {
  new: "Will be added",
  existing: "Already in People",
  suppressed: "Skipped: deleted before",
  duplicate: "Skipped: repeated in file",
  invalid: "Skipped",
};

const LISTED = 100;

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

// A spreadsheet cell that starts with = + - or @ is read as a formula by
// Excel, so the list of skipped rows is written with those held back.
function csvCell(value: string | number) {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function skippedCsv(rows: PreviewRow[]) {
  const lines = ["Row,Name,Outcome,Reason"];
  for (const row of rows) lines.push([row.n, row.name, OUTCOME[row.status], [row.reason, ...row.warnings].filter(Boolean).join("; ")].map(csvCell).join(","));
  return lines.join("\r\n");
}

export function PeopleImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<string[] | null>(null);
  const [fillGaps, setFillGaps] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const latest = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  function body(chosen: File, columns: string[] | null) {
    const form = new FormData();
    form.set("file", chosen);
    if (columns) form.set("mapping", JSON.stringify(columns));
    return form;
  }

  function runPreview(chosen: File, columns: string[] | null) {
    const ticket = ++latest.current;
    setError(null);
    startTransition(async () => {
      const state: ImportState = await previewPeopleImport(body(chosen, columns));
      if (ticket !== latest.current) return;
      if (state.error || !state.preview) {
        setError(state.error ?? "That file could not be read.");
        setPreview(null);
        return;
      }
      setPreview(state.preview);
      setMapping(state.preview.mapping);
    });
  }

  function chooseFile(chosen: File | null) {
    setResult(null);
    setConfirm(false);
    setPreview(null);
    setMapping(null);
    setFile(chosen);
    if (chosen) runPreview(chosen, null);
    else setError(null);
  }

  function chooseField(column: number, field: string) {
    if (!file || !mapping) return;
    // One column per field: choosing a field moves it off whichever column had it.
    const next = mapping.map((current, i) => (i === column ? field : field && current === field ? "" : current));
    setMapping(next);
    setConfirm(false);
    runPreview(file, next);
  }

  function runImport() {
    if (!file || !mapping) return;
    const ticket = ++latest.current;
    setError(null);
    startTransition(async () => {
      const form = body(file, mapping);
      form.set("confirm", confirm ? "on" : "");
      if (fillGaps) form.set("fillGaps", "on");
      const state = await runPeopleImport(form);
      if (ticket !== latest.current) return;
      if (state.error || !state.result) {
        setError(state.error ?? "Nothing was imported.");
        return;
      }
      setResult(state.result);
      setPreview(null);
      setConfirm(false);
    });
  }

  function reset() {
    latest.current += 1;
    setFile(null);
    setMapping(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setConfirm(false);
    if (input.current) input.current.value = "";
  }

  const totals = preview?.totals;
  const listed = preview ? preview.rows.filter((row) => row.status !== "new" || row.warnings.length > 0 || row.reason) : [];
  const skipped = preview ? preview.rows.filter((row) => row.status !== "new" && row.status !== "existing") : [];
  const willChange = totals ? totals.new > 0 || totals.doNotContactOnExisting > 0 || fillGaps : false;

  return (
    <div className="space-y-6">
      {result ? (
        <section aria-label="Import finished" className="card space-y-3">
          <p role="status" className="auth-success">
            Imported {plural(result.created, "person", "people")}.
            {result.markedDoNotContact > 0 && ` ${plural(result.markedDoNotContact, "person", "people")} already in People ${result.markedDoNotContact === 1 ? "was" : "were"} marked do not contact.`}
            {result.filled > 0 && ` Filled gaps on ${plural(result.filled, "record", "records")}.`}
          </p>
          <p className="section-caption">
            Skipped: {result.skipped.existing} already in People, {result.skipped.suppressed} deleted before, {result.skipped.duplicate} repeated in the file, {result.skipped.invalid} without a usable name.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/people" className="btn-primary">See your people</Link>
            <button type="button" className="btn-secondary" onClick={reset}>Import another file</button>
          </div>
        </section>
      ) : (
        <section aria-label="Choose a file" className="card space-y-3">
          <label htmlFor="people-file" className="field-label">Excel (.xlsx) or CSV file</label>
          <input
            id="people-file"
            ref={input}
            type="file"
            accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="field-input"
            onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
          />
          <p className="section-caption">The first row must be the column names. Only the first sheet is read, up to 2,000 people. Nothing is saved until you press Import.</p>
          {pending && !preview && <p role="status" className="section-caption">Reading the file…</p>}
        </section>
      )}

      {error && <p role="alert" data-form-message="error" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>}

      {preview && !result && (
        <>
          <section aria-label="Columns" className="card space-y-3">
            <h2 className="text-lg">Match your columns</h2>
            <p className="section-caption">Capture guessed what each column holds. Change any that are wrong; columns set to Do not import are ignored.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr><th className="py-1 pr-3 font-medium">Column in your file</th><th className="py-1 pr-3 font-medium">First person</th><th className="py-1 font-medium">Import as</th></tr></thead>
                <tbody>
                  {preview.header.map((name, column) => (
                    <tr key={column} className="border-t border-line align-top">
                      <td className="py-2 pr-3">{name || <span className="text-ink-soft">(no heading)</span>}</td>
                      <td className="max-w-[16rem] break-words py-2 pr-3 text-ink-soft">{preview.sample[column]}</td>
                      <td className="py-2">
                        <select
                          aria-label={`Import column ${name || column + 1} as`}
                          className="field-input"
                          value={mapping?.[column] ?? ""}
                          disabled={pending}
                          onChange={(event) => chooseField(column, event.target.value)}
                        >
                          <option value="">Do not import</option>
                          {IMPORT_FIELDS.map((field: string) => <option key={field} value={field}>{FIELD_LABELS[field as keyof typeof FIELD_LABELS]}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.needsName && <p role="alert" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">Choose which column holds the name (or the first and last name) to see what would be imported.</p>}
          </section>

          {!preview.needsName && totals && (
            <>
              <section aria-label="What will happen" className="card space-y-3">
                <h2 className="text-lg">What will happen</h2>
                <ul className="space-y-1 text-sm">
                  <li><strong data-count="new">{totals.new.toLocaleString("en-GB")}</strong> {totals.new === 1 ? "person" : "people"} will be added</li>
                  <li><strong data-count="existing">{totals.existing.toLocaleString("en-GB")}</strong> already in People{fillGaps ? " (empty fields will be filled)" : " (left as they are)"}</li>
                  {totals.doNotContactOnExisting > 0 && <li><strong>{totals.doNotContactOnExisting.toLocaleString("en-GB")}</strong> of those will be marked do not contact</li>}
                  <li><strong data-count="suppressed">{totals.suppressed.toLocaleString("en-GB")}</strong> skipped because you deleted them before</li>
                  <li><strong data-count="duplicate">{totals.duplicate.toLocaleString("en-GB")}</strong> skipped as repeats within this file</li>
                  <li><strong data-count="invalid">{totals.invalid.toLocaleString("en-GB")}</strong> skipped without a usable name</li>
                  {totals.warned > 0 && <li><strong>{totals.warned.toLocaleString("en-GB")}</strong> with a link, id or email that was left out</li>}
                </ul>
                {totals.noLink > 0 && <p className="section-caption">{plural(totals.noLink, "person has", "people have")} no profile link, so they cannot be recognised if you import them again. Imported people also appear without any confirmed salary, notice or right to work: those come from a screening.</p>}
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={fillGaps} onChange={(event) => setFillGaps(event.target.checked)} className="mt-1" />
                  <span>Fill empty headline, location, skills and email on people already in People. Nothing already there is overwritten.</span>
                </label>
              </section>

              {listed.length > 0 && (
                <section aria-label="Rows to look at" className="card space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-lg">Rows to look at</h2>
                    {skipped.length > 0 && (
                      <button
                        type="button"
                        className="btn-quiet"
                        onClick={() => {
                          const url = URL.createObjectURL(new Blob([skippedCsv(skipped)], { type: "text/csv;charset=utf-8" }));
                          const link = document.createElement("a");
                          link.href = url;
                          link.download = "skipped-rows.csv";
                          link.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        Download skipped rows
                      </button>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead><tr><th className="py-1 pr-3 font-medium">Row</th><th className="py-1 pr-3 font-medium">Name</th><th className="py-1 pr-3 font-medium">Outcome</th><th className="py-1 font-medium">Why</th></tr></thead>
                      <tbody>
                        {listed.slice(0, LISTED).map((row) => (
                          <tr key={row.n} className="border-t border-line align-top">
                            <td className="py-1 pr-3 tabular">{row.n}</td>
                            <td className="py-1 pr-3 break-words">{row.name || "—"}</td>
                            <td className="py-1 pr-3">{OUTCOME[row.status]}</td>
                            <td className="py-1 text-ink-soft">{[row.reason, ...row.warnings].filter(Boolean).join("; ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {listed.length > LISTED && <p className="section-caption">Showing the first {LISTED} of {listed.length.toLocaleString("en-GB")}. The download lists every skipped row.</p>}
                </section>
              )}

              <section aria-label="Import" className="card space-y-3">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} className="mt-1" />
                  <span>These are people I have a legitimate reason to keep records about, and I will tell any of them what I hold if they ask.</span>
                </label>
                <button type="button" className="btn-primary" disabled={pending || !confirm || !willChange} onClick={runImport}>
                  {pending ? "Please wait…" : `Import ${plural(totals.new, "person", "people")}`}
                </button>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
