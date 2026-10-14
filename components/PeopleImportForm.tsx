"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { previewPeopleImport, runPeopleImport, type ImportState } from "@/app/actions/people-import";
import type { ImportResult, Preview, PreviewRow } from "@/lib/people-import-server";
import { FIELD_LABELS, IMPORT_FIELDS } from "@/lib/people-import-fields.mjs";

// Three steps, one decision each: choose a file, check what will happen, done.
// Reading the file moves straight on to the check, and the columns are only
// put in front of the recruiter when Capture could not tell which one holds
// the name or when they ask to change them.

type Step = "file" | "review" | "done";

const OUTCOME: Record<PreviewRow["status"], string> = {
  new: "Will be added",
  existing: "Already in People",
  suppressed: "Skipped: deleted before",
  duplicate: "Skipped: repeated in the file",
  invalid: "Skipped",
};

const LISTED = 100;
const STEPS: { id: Step; label: string }[] = [
  { id: "file", label: "Choose file" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const people = (n: number) => plural(n, "person", "people");
const label = (field: string) => FIELD_LABELS[field as keyof typeof FIELD_LABELS];

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

function downloadSkipped(rows: PreviewRow[]) {
  const url = URL.createObjectURL(new Blob([skippedCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "skipped-rows.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function Steps({ current }: { current: Step }) {
  const at = STEPS.findIndex((step) => step.id === current);
  return (
    <ol className="import-steps" aria-label="Progress">
      {STEPS.map((step, i) => (
        <li key={step.id} aria-current={i === at ? "step" : undefined}>
          <span className="step-no" aria-hidden="true">{i + 1}</span>
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function PeopleImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<string[] | null>(null);
  const [fillGaps, setFillGaps] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [skipped, setSkipped] = useState<PreviewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [pending, startTransition] = useTransition();
  const latest = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const shown = useRef<Step>("file");

  const step: Step = result ? "done" : preview ? "review" : "file";

  // Each new screen takes focus at its heading, so a keyboard or screen
  // reader user lands on what just changed rather than on a control that has
  // been replaced.
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    if (step === "review") reviewHeading.current?.focus();
    if (step === "done") doneHeading.current?.focus();
    if (step === "file") input.current?.focus();
  }, [step]);

  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);

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
        setError(state.error ?? "That file could not be read. Check it is an .xlsx or .csv file with column names in the first row, then choose it again.");
        setPreview(null);
        return;
      }
      const next = state.preview;
      setPreview(next);
      setMapping(next.mapping);
      if (next.needsName) setColumnsOpen(true);
      setAnnounce(
        next.needsName
          ? "Choose which column holds the name."
          : `File read. ${people(next.totals.new)} will be added, ${next.totals.rows.toLocaleString("en-GB")} rows checked.`
      );
    });
  }

  function chooseFile(chosen: File | null) {
    setConfirm(false);
    setPreview(null);
    setMapping(null);
    setColumnsOpen(false);
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
    if (!file || !mapping || !preview) return;
    const ticket = ++latest.current;
    const skippedNow = preview.rows.filter((row) => row.status !== "new" && row.status !== "existing");
    setError(null);
    startTransition(async () => {
      const form = body(file, mapping);
      form.set("confirm", confirm ? "on" : "");
      if (fillGaps) form.set("fillGaps", "on");
      const state = await runPeopleImport(form);
      if (ticket !== latest.current) return;
      if (state.error || !state.result) {
        setError(`${state.error ?? "Nothing was imported."} Nothing has been saved.`);
        return;
      }
      setSkipped(skippedNow);
      setResult(state.result);
      setPreview(null);
      setConfirm(false);
      setAnnounce(`Imported ${people(state.result.created)}.`);
    });
  }

  function reset() {
    latest.current += 1;
    setFile(null);
    setMapping(null);
    setPreview(null);
    setResult(null);
    setSkipped([]);
    setError(null);
    setConfirm(false);
    setFillGaps(false);
    setColumnsOpen(false);
    if (input.current) input.current.value = "";
    input.current?.focus();
  }

  const totals = preview?.totals;
  const flagged = preview ? preview.rows.filter((row) => (row.status !== "new" && row.status !== "existing") || row.warnings.length > 0) : [];
  const skippedRows = preview ? preview.rows.filter((row) => row.status !== "new" && row.status !== "existing") : [];
  const willChange = totals ? totals.new > 0 || totals.doNotContactOnExisting > 0 || (fillGaps && totals.existing > 0) : false;
  const hint = !preview || preview.needsName
    ? "Choose the name column first."
    : !willChange
      ? "Nobody new to add."
      : !confirm
        ? "Tick the box above to import."
        : "";
  const importLabel = pending && preview
    ? `Importing ${people(totals?.new ?? 0)}…`
    : totals && totals.new > 0
      ? `Import ${people(totals.new)}`
      : willChange
        ? "Update people already in People"
        : "Nothing new to import";

  return (
    <div className="space-y-6">
      <Steps current={step} />
      <p role="status" className="sr-only">{announce}</p>

      {error && (
        <p ref={errorBox} tabIndex={-1} role="alert" data-form-message="error" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {error}
        </p>
      )}

      {step === "file" && (
        <section aria-label="Choose a file">
          <div
            className="import-drop"
            data-drag={drag}
            onDragOver={(event) => { event.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(event) => { event.preventDefault(); setDrag(false); chooseFile(event.dataTransfer.files?.[0] ?? null); }}
          >
            <p className="text-lg font-medium">{pending ? `Reading ${file?.name ?? "your file"}…` : "Drop your spreadsheet here"}</p>
            <label htmlFor="people-file" className="btn-primary cursor-pointer">Choose a file</label>
            <input
              id="people-file"
              ref={input}
              type="file"
              accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
            <p className="section-caption max-w-md">Excel (.xlsx) or CSV, with column names in the first row and up to 2,000 people. Nothing is saved until you press Import.</p>
          </div>
        </section>
      )}

      {step === "review" && preview && totals && (
        <>
          <section aria-label="Review" className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 break-words text-sm text-ink-soft">{file?.name} · {plural(totals.rows, "row", "rows")} read</p>
              <button type="button" className="btn-quiet" onClick={reset}>Choose a different file</button>
            </div>

            {preview.needsName ? (
              <>
                <h2 ref={reviewHeading} tabIndex={-1} className="import-heading text-xl">Which column holds the name?</h2>
                <p className="text-sm text-ink-soft">Capture could not tell. Choose the column with each person&rsquo;s name (or first and last name) and the rest follows.</p>
              </>
            ) : (
              <>
                <h2 ref={reviewHeading} tabIndex={-1} className="import-heading text-2xl">
                  {totals.new > 0 ? <><span data-count="new">{totals.new.toLocaleString("en-GB")}</span> {totals.new === 1 ? "person" : "people"} will be added</> : "Nobody new in this file"}
                </h2>
                {preview.newNames.length > 0 && (
                  <p className="break-words text-sm">
                    {preview.newNames.join(", ")}
                    {totals.new > preview.newNames.length && <span className="text-ink-soft"> and {(totals.new - preview.newNames.length).toLocaleString("en-GB")} more</span>}
                  </p>
                )}
                <ul className="space-y-1 text-sm text-ink-soft" aria-label="What else will happen">
                  {totals.existing > 0 && <li><span data-count="existing">{totals.existing.toLocaleString("en-GB")}</span> already in People{fillGaps ? ": their empty fields will be filled" : ", left as they are"}</li>}
                  {totals.doNotContactOnExisting > 0 && <li>{plural(totals.doNotContactOnExisting, "of them", "of them")} will be marked do not contact</li>}
                  {totals.suppressed > 0 && <li><span data-count="suppressed">{totals.suppressed.toLocaleString("en-GB")}</span> skipped: you deleted them from People before</li>}
                  {totals.duplicate > 0 && <li><span data-count="duplicate">{totals.duplicate.toLocaleString("en-GB")}</span> skipped: repeated in this file</li>}
                  {totals.invalid > 0 && <li><span data-count="invalid">{totals.invalid.toLocaleString("en-GB")}</span> skipped: no usable name</li>}
                  {totals.warned > 0 && <li>{plural(totals.warned, "person has", "people have")} a link, id or email that was left out; they are still added</li>}
                  {totals.noLink > 0 && <li>{plural(totals.noLink, "person has", "people have")} no profile link, so importing the same file again would add them twice</li>}
                </ul>
                {totals.existing > 0 && (
                  <label className="import-check">
                    <input type="checkbox" checked={fillGaps} onChange={(event) => setFillGaps(event.target.checked)} />
                    <span>Also fill empty headline, location, skills and email for the people already in People. Nothing they already have is changed.</span>
                  </label>
                )}
                {flagged.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-sm">Rows to look at ({flagged.length.toLocaleString("en-GB")})</summary>
                    <ul className="import-list mt-3" aria-label="Rows to look at">
                      {flagged.slice(0, LISTED).map((row) => (
                        <li key={row.n} className="text-sm">
                          <p><span className="tabular text-ink-soft">Row {row.n}</span> · <span className="break-words font-medium">{row.name || "No name"}</span> · {OUTCOME[row.status]}</p>
                          {(row.reason || row.warnings.length > 0) && <p className="break-words text-ink-soft">{[row.reason, ...row.warnings].filter(Boolean).join("; ")}</p>}
                        </li>
                      ))}
                    </ul>
                    {flagged.length > LISTED && <p className="section-caption mt-2">Showing the first {LISTED}.{skippedRows.length > 0 && " The download lists every skipped row."}</p>}
                    {skippedRows.length > 0 && <button type="button" className="btn-quiet mt-3" onClick={() => downloadSkipped(skippedRows)}>Download skipped rows</button>}
                  </details>
                )}
              </>
            )}

            {!preview.needsName && <p className="section-caption">Nobody already in People is overwritten. People you deleted before stay deleted. An import cannot be undone, but you can erase people one by one.</p>}

            <div className="space-y-3 border-t border-line pt-3">
              {!preview.needsName && mapping && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 break-words text-sm text-ink-soft">
                    Columns read: {mapping.filter(Boolean).map(label).join(", ")}
                    {mapping.some((field) => !field) && ` · ${plural(mapping.filter((field) => !field).length, "column", "columns")} not imported`}
                  </p>
                  <button type="button" className="btn-quiet" aria-expanded={columnsOpen} aria-controls="import-columns" onClick={() => setColumnsOpen(!columnsOpen)}>
                    {columnsOpen ? "Hide columns" : "Change columns"}
                  </button>
                </div>
              )}
              {columnsOpen && mapping && (
                <div id="import-columns" aria-busy={pending}>
                  {pending && <p role="status" className="section-caption mb-2">Updating the preview…</p>}
                  <ul className="import-list" aria-label="Columns in your file">
                    {preview.header.map((name, column) => (
                      <li key={column} className="import-column">
                        <span className="min-w-0 break-words text-sm font-medium">{name || "(no heading)"}</span>
                        <span className="min-w-0 break-words text-sm text-ink-soft">{preview.sample[column] || "empty"}</span>
                        <select
                          aria-label={`Import column ${name || column + 1} as`}
                          className="field-input"
                          value={mapping[column] ?? ""}
                          onChange={(event) => chooseField(column, event.target.value)}
                        >
                          <option value="">Do not import</option>
                          {IMPORT_FIELDS.map((field: string) => <option key={field} value={field}>{label(field)}</option>)}
                        </select>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>

          <section aria-label="Import" className="card import-commit space-y-3">
            <label className="import-check">
              <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
              <span>I have a legitimate reason to keep records on these people, and will tell them what I hold if they ask.</span>
            </label>
            <button type="button" className="btn-primary w-full sm:w-auto" disabled={pending || !confirm || !willChange || preview.needsName} aria-describedby="import-hint" onClick={runImport}>
              {importLabel}
            </button>
            <p id="import-hint" className="section-caption min-h-[1.25rem]">{hint}</p>
          </section>
        </>
      )}

      {step === "done" && result && (
        <section aria-label="Import finished" className="card space-y-3">
          <h2 ref={doneHeading} tabIndex={-1} className="import-heading text-2xl">Imported {people(result.created)}</h2>
          <ul className="space-y-1 text-sm text-ink-soft">
            {result.markedDoNotContact > 0 && <li>{plural(result.markedDoNotContact, "person", "people")} already in People marked do not contact</li>}
            {result.filled > 0 && <li>Empty fields filled on {plural(result.filled, "record", "records")}</li>}
            {result.skipped.existing > 0 && <li>{result.skipped.existing.toLocaleString("en-GB")} already in People, left as they were</li>}
            {result.skipped.suppressed > 0 && <li>{result.skipped.suppressed.toLocaleString("en-GB")} skipped: deleted before</li>}
            {result.skipped.duplicate > 0 && <li>{result.skipped.duplicate.toLocaleString("en-GB")} skipped: repeated in the file</li>}
            {result.skipped.invalid > 0 && <li>{result.skipped.invalid.toLocaleString("en-GB")} skipped: no usable name</li>}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Link href="/people" className="btn-primary">See your people</Link>
            <button type="button" className="btn-secondary" onClick={reset}>Import another file</button>
            {skipped.length > 0 && <button type="button" className="btn-quiet" onClick={() => downloadSkipped(skipped)}>Download skipped rows</button>}
          </div>
        </section>
      )}
    </div>
  );
}
