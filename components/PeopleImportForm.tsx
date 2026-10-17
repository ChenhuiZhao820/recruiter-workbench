"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { previewPeopleImport, runPeopleImport, type ImportState } from "@/app/actions/people-import";
import type { ImportOptions, ImportResult, Preview, PreviewRow } from "@/lib/people-import-server";
import { FIELD_LABELS, IMPORT_FIELDS } from "@/lib/people-import-fields.mjs";
import { ImportUndo } from "@/components/ImportUndo";

// Three steps, one decision each: choose a file, check what will happen, done.
// Reading the file moves straight on to the check. Capture's readings of an
// odd file (headings lower down, names written surname first, a heading row
// above each group) are each one line with one button to undo that reading;
// a question appears only when guessing would be unsafe - which column is the
// name, and whether a "Role" column means the job they are considered for.
// Every choice is sent back with the file and checked again on the server.

type Step = "file" | "review" | "done";

const OUTCOME: Record<PreviewRow["status"], string> = {
  new: "Will be added",
  existing: "Already in People",
  suppressed: "Skipped: deleted before",
  duplicate: "Combined with an earlier row",
  invalid: "Skipped",
  excluded: "Left out by you",
};

const LISTED = 200;
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

function downloadSkipped(rows: PreviewRow[]) {
  const lines = ["Row,Name,Outcome,Reason"];
  for (const row of rows) lines.push([row.n, row.name, OUTCOME[row.status], [row.reason, ...row.warnings].filter(Boolean).join("; ")].map(csvCell).join(","));
  const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
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

// One line saying how Capture read something, and the button that reads it
// the other way.
function Reading({ children, action, onClick }: { children: React.ReactNode; action: string; onClick: () => void }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="min-w-0 break-words">{children}</span>
      <button type="button" className="import-link" onClick={onClick}>{action}</button>
    </li>
  );
}

export function PeopleImportForm({ until }: { until: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<ImportOptions>({});
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

  function body(chosen: File, next: ImportOptions) {
    const form = new FormData();
    form.set("file", chosen);
    form.set("options", JSON.stringify(next));
    return form;
  }

  function runPreview(chosen: File, next: ImportOptions) {
    const ticket = ++latest.current;
    setError(null);
    startTransition(async () => {
      const state: ImportState = await previewPeopleImport(body(chosen, next));
      if (ticket !== latest.current) return;
      if (state.error || !state.preview) {
        setError(state.error ?? "That file could not be read. Check it is an .xlsx or .csv file, then choose it again.");
        setPreview(null);
        return;
      }
      const ready = state.preview;
      setPreview(ready);
      if (ready.needsName) setColumnsOpen(true);
      setAnnounce(
        ready.questions > 0
          ? `File read. ${plural(ready.questions, "question needs", "questions need")} an answer before importing.`
          : `File read. ${people(ready.totals.new)} will be added.`
      );
    });
  }

  function update(change: Partial<ImportOptions>) {
    if (!file) return;
    const next = { ...options, ...change };
    setOptions(next);
    setConfirm(false);
    runPreview(file, next);
  }

  function chooseFile(chosen: File | null) {
    setConfirm(false);
    setPreview(null);
    setOptions({});
    setFillGaps(false);
    setColumnsOpen(false);
    setFile(chosen);
    if (chosen) runPreview(chosen, {});
    else setError(null);
  }

  function chooseField(column: number, field: string) {
    if (!preview) return;
    const single = field && !["location", "skills", "notes"].includes(field);
    const mapping = preview.mapping.map((current, i) => (i === column ? field : single && current === field ? "" : current));
    update({ mapping });
  }

  function toggleRow(n: number, include: boolean) {
    const exclude = new Set(options.exclude ?? []);
    if (include) exclude.delete(n);
    else exclude.add(n);
    update({ exclude: Array.from(exclude) });
  }

  function runImport() {
    if (!file || !preview) return;
    const ticket = ++latest.current;
    const skippedNow = preview.rows.filter((row) => row.status !== "new" && row.status !== "existing" && row.status !== "duplicate");
    setError(null);
    startTransition(async () => {
      const form = body(file, options);
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
    setOptions({});
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
  const role = preview?.role ?? null;
  const roleUndecided = Boolean(role && !role.answer);
  const roleValues = role?.answer === "role" ? role.values : [];
  const matched = roleValues.filter((value) => value.kind === "match" && value.choice !== "none");
  const toDecide = roleValues.filter((value) => value.kind !== "match");
  const newValues = toDecide.filter((value) => value.kind === "new");
  const willChange = totals ? totals.new > 0 || totals.doNotContactOnExisting > 0 || totals.addedToRoles > 0 || (fillGaps && totals.existing > 0) : false;
  const questions = preview?.questions ?? 0;
  const hint = !preview
    ? ""
    : questions > 0
      ? `Answer the ${questions === 1 ? "question" : "questions"} above to import.`
      : !willChange
        ? "Nobody new to add."
        : !confirm
          ? "Tick the box above to import."
          : "";
  const importLabel = pending && preview
    ? "Importing…"
    : questions > 0
      ? `Answer ${plural(questions, "question", "questions")} to import`
      : totals && totals.new > 0
        ? `Import ${people(totals.new)}`
        : willChange
          ? "Update people already in People"
          : "Nothing new to import";
  const readings = preview?.readings;
  const roleChoice = (key: string, value: string) => update({ roleChoices: { ...(options.roleChoices ?? {}), [key]: value } });

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
              accept=".xlsx,.csv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
            <p className="section-caption max-w-md">Excel (.xlsx) or CSV, laid out however you keep it, up to 2,000 people. Nothing is saved until you press Import.</p>
          </div>
        </section>
      )}

      {step === "review" && preview && totals && (
        <>
          <section aria-label="Review" className="card space-y-4" aria-busy={pending}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 break-words text-sm text-ink-soft">
                {file?.name}{preview.sheets.length > 1 && ` · sheet "${preview.sheets[preview.sheet]}"`} · {plural(totals.rows, "row", "rows")} read
                {pending && " · updating…"}
              </p>
              <button type="button" className="btn-quiet" onClick={reset}>Choose a different file</button>
            </div>

            {preview.needsName && (
              <div className="import-question space-y-2">
                <h2 ref={reviewHeading} tabIndex={-1} className="import-heading text-xl">Which column holds the name?</h2>
                <p className="text-sm text-ink-soft">Choose the column with each person&rsquo;s name, or their first or last name, under Change columns below.</p>
              </div>
            )}

            {!preview.needsName && role && roleUndecided && (
              <fieldset className="import-question space-y-2">
                <legend className="text-base font-medium">What does the &ldquo;{role.header}&rdquo; column mean?</legend>
                <p className="break-words text-sm text-ink-soft">{role.sample.map((value) => `${value.label} (${value.count})`).join(" · ")}</p>
                <label className="import-check">
                  <input type="radio" name="role-answer" onChange={() => update({ roleAnswer: "role" })} />
                  <span>The role each person is being considered for: put them on those roles</span>
                </label>
                <label className="import-check">
                  <input type="radio" name="role-answer" onChange={() => update({ roleAnswer: "headline" })} />
                  <span>Their current job title</span>
                </label>
              </fieldset>
            )}

            {!preview.needsName && (
              <>
                <h2 ref={preview.needsName ? undefined : reviewHeading} tabIndex={-1} className="import-heading text-2xl">
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
                  {totals.addedToRoles > 0 && <li><span data-count="roles">{totals.addedToRoles.toLocaleString("en-GB")}</span> {totals.addedToRoles === 1 ? "place" : "places"} on roles{totals.newRoles > 0 && `, including ${plural(totals.newRoles, "new role", "new roles")}`}</li>}
                  {totals.doNotContactOnExisting > 0 && <li>{plural(totals.doNotContactOnExisting, "person", "people")} already in People will be marked do not contact</li>}
                  {totals.duplicate > 0 && <li><span data-count="duplicate">{totals.duplicate.toLocaleString("en-GB")}</span> {totals.duplicate === 1 ? "row is" : "rows are"} the same person as an earlier row and combined with it</li>}
                  {totals.suppressed > 0 && <li><span data-count="suppressed">{totals.suppressed.toLocaleString("en-GB")}</span> skipped: you deleted them from People before</li>}
                  {totals.invalid > 0 && <li><span data-count="invalid">{totals.invalid.toLocaleString("en-GB")}</span> skipped: no usable name</li>}
                  {totals.excluded > 0 && <li><span data-count="excluded">{totals.excluded.toLocaleString("en-GB")}</span> left out by you</li>}
                  {totals.warned > 0 && <li>{plural(totals.warned, "person has", "people have")} a link, id or email that was left out; they are still added</li>}
                  {totals.noLink > 0 && <li>{plural(totals.noLink, "person has", "people have")} no profile link, so importing the same file again would add them twice</li>}
                </ul>

                {roleValues.length > 0 && (
                  <div className="space-y-2" aria-label="Roles in your file" role="group">
                    <h3 className="text-sm font-medium">Roles in your file</h3>
                    {matched.length > 0 && <p className="break-words text-sm text-ink-soft">Added to your roles: {matched.map((value) => `${value.label} (${value.people})`).join(", ")}</p>}
                    {toDecide.length > 0 && (
                      <ul className="import-list">
                        {toDecide.map((value) => (
                          <li key={value.key} className="import-column">
                            <span className="min-w-0 break-words text-sm font-medium">{value.label}</span>
                            <span className="text-sm text-ink-soft">
                              {people(value.people)} · {value.kind === "new" ? "not a role yet" : value.kind === "near" ? "close to a role you have" : value.kind === "closed" ? "that role is closed" : "you have more than one"}
                            </span>
                            <select aria-label={`Role for ${value.label}`} className="field-input" value={value.choice} onChange={(event) => roleChoice(value.key, event.target.value)}>
                              {value.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </li>
                        ))}
                      </ul>
                    )}
                    {newValues.length > 1 && newValues.some((value) => value.choice !== "create") && (
                      <button type="button" className="import-link" onClick={() => update({ roleChoices: { ...(options.roleChoices ?? {}), ...Object.fromEntries(newValues.map((value) => [value.key, "create"])) } })}>
                        Create all {newValues.length} new roles
                      </button>
                    )}
                  </div>
                )}

                {totals.existing > 0 && (
                  <label className="import-check">
                    <input type="checkbox" checked={fillGaps} onChange={(event) => setFillGaps(event.target.checked)} />
                    <span>Also fill empty headline, location, skills and email for the people already in People. Nothing they already have is changed.</span>
                  </label>
                )}
              </>
            )}

            {readings && (
              <ul className="space-y-2 border-t border-line pt-3 text-sm text-ink-soft" aria-label="How Capture read your file">
                {readings.skippedAbove > 0 && (
                  <Reading action="Change" onClick={() => setColumnsOpen(true)}>Headings found on row {preview.headerChoices[preview.headerRow]?.label.match(/^Row (\d+)/)?.[1]}; {readings.skippedAbove === 1 ? "the row above was skipped" : `the ${readings.skippedAbove} rows above were skipped`}</Reading>
                )}
                {preview.headerRow === -1 && <Reading action="Change" onClick={() => setColumnsOpen(true)}>No row of headings: the first row is read as a person</Reading>}
                {readings.nameFromEmail && (
                  <Reading action="Choose a name column" onClick={() => { setColumnsOpen(true); update({ nameFromEmail: false }); }}>There is no name column, so names are read from email addresses (jane.doe@ is Jane Doe)</Reading>
                )}
                {readings.groupRows && (
                  readings.groupRows.on
                    ? <Reading action="Read them as people" onClick={() => update({ groupRows: false, mapping: undefined })}>{plural(readings.groupRows.count ?? 0, "row", "rows")} like &ldquo;{readings.groupRows.example}&rdquo; read as a heading for the people under it</Reading>
                    : <Reading action="Read as headings" onClick={() => update({ groupRows: true, mapping: undefined })}>Rows like &ldquo;{readings.groupRows.example}&rdquo; are read as people</Reading>
                )}
                {role?.answer && (
                  <Reading action={role.answer === "role" ? "Read as job title" : "Read as roles"} onClick={() => update({ roleAnswer: role.answer === "role" ? "headline" : "role" })}>
                    &ldquo;{role.header}&rdquo; read as {role.answer === "role" ? "the role each person is considered for" : "their current job title"}
                  </Reading>
                )}
                {readings.names && (
                  readings.names.on
                    ? <Reading action="Keep as written" onClick={() => update({ swapNames: false, fixCase: false })}>Names like &ldquo;{readings.names.before}&rdquo; are written &ldquo;{readings.names.after}&rdquo;</Reading>
                    : <Reading action="Tidy them" onClick={() => update({ swapNames: undefined, fixCase: undefined })}>Names are kept as written, like &ldquo;{readings.names.before}&rdquo;</Reading>
                )}
                {readings.keepOther.columns.length > 0 && (
                  <Reading action={readings.keepOther.on ? "Do not keep" : "Keep"} onClick={() => update({ keepOther: !readings.keepOther.on })}>
                    {readings.keepOther.on ? "Kept in each person's note" : "Not imported"}: {readings.keepOther.columns.join(", ")}
                  </Reading>
                )}
                <Reading action={columnsOpen ? "Hide columns" : "Change columns"} onClick={() => setColumnsOpen(!columnsOpen)}>
                  {preview.mapping.some(Boolean) ? `Columns read: ${Array.from(new Set(preview.mapping.filter(Boolean).map(label))).join(", ")}` : "No columns recognised yet"}
                </Reading>
              </ul>
            )}

            {columnsOpen && (
              <div id="import-columns" className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {preview.sheets.length > 1 && (
                    <label className="text-sm">
                      <span className="mb-1 block text-ink-soft">Sheet</span>
                      <select className="field-input" value={preview.sheet} onChange={(event) => update({ sheet: Number(event.target.value), headerRow: undefined, mapping: undefined, groupRows: undefined, exclude: [] })}>
                        {preview.sheets.map((name, i) => <option key={i} value={i}>{name}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="text-sm">
                    <span className="mb-1 block text-ink-soft">Row with the headings</span>
                    <select className="field-input" value={preview.headerRow} onChange={(event) => update({ headerRow: Number(event.target.value), mapping: undefined, groupRows: undefined })}>
                      {preview.headerChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                    </select>
                  </label>
                </div>
                <ul className="import-list" aria-label="Columns in your file">
                  {preview.header.map((name, column) => (
                    <li key={column} className="import-column">
                      <span className="min-w-0 break-words text-sm font-medium">{name}</span>
                      <span className="min-w-0 break-words text-sm text-ink-soft">{preview.sample[column] || "empty"}</span>
                      <select aria-label={`Import column ${name} as`} className="field-input" value={preview.mapping[column] ?? ""} onChange={(event) => chooseField(column, event.target.value)}>
                        <option value="">Do not import</option>
                        {IMPORT_FIELDS.map((field: string) => <option key={field} value={field}>{label(field)}</option>)}
                      </select>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!preview.needsName && preview.rows.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm">Check every row ({preview.rows.length.toLocaleString("en-GB")})</summary>
                <ul className="import-list mt-3" aria-label="Every row">
                  {preview.rows.slice(0, LISTED).map((row) => {
                    const choosable = row.status === "new" || row.status === "existing" || row.status === "excluded";
                    return (
                      <li key={row.n} className="text-sm">
                        <label className={choosable ? "import-check" : "flex gap-3"}>
                          {choosable && <input type="checkbox" checked={!(options.exclude ?? []).includes(row.n)} onChange={(event) => toggleRow(row.n, event.target.checked)} aria-label={`Import row ${row.n}`} />}
                          <span className="min-w-0">
                            <span className="tabular text-ink-soft">Row {row.n}</span> · <span className="break-words font-medium">{row.name || "No name"}</span> · {OUTCOME[row.status]}
                            {row.roles.length > 0 && <span className="text-ink-soft"> · {row.roles.join(", ")}</span>}
                            {(row.reason || row.warnings.length > 0) && <span className="block break-words text-ink-soft">{[row.reason, ...row.warnings].filter(Boolean).join("; ")}</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {preview.rows.length > LISTED && <p className="section-caption mt-2">Showing the first {LISTED}. The download lists every skipped row.</p>}
                {preview.rows.some((row) => row.status === "invalid" || row.status === "suppressed") && (
                  <button type="button" className="btn-quiet mt-3" onClick={() => downloadSkipped(preview.rows.filter((row) => row.status === "invalid" || row.status === "suppressed" || row.status === "excluded"))}>Download skipped rows</button>
                )}
              </details>
            )}

            {!preview.needsName && <p className="section-caption">Nobody already in People is overwritten. People you deleted before stay deleted. You can undo this import until {until}.</p>}
          </section>

          <section aria-label="Import" className="card import-commit space-y-3">
            <label className="import-check">
              <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
              <span>I have a legitimate reason to keep records on these people, and will tell them what I hold if they ask.</span>
            </label>
            <button type="button" className="btn-primary w-full sm:w-auto" disabled={pending || !confirm || !willChange || questions > 0} aria-describedby="import-hint" onClick={runImport}>
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
            {result.addedToRoles > 0 && <li>{plural(result.addedToRoles, "place", "places")} on roles{result.rolesCreated > 0 && `, in ${plural(result.rolesCreated, "new role", "new roles")}`}</li>}
            {result.markedDoNotContact > 0 && <li>{people(result.markedDoNotContact)} already in People marked do not contact</li>}
            {result.filled > 0 && <li>Empty fields filled on {plural(result.filled, "record", "records")}</li>}
            {result.skipped.existing > 0 && <li>{result.skipped.existing.toLocaleString("en-GB")} already in People, left as they were</li>}
            {result.skipped.duplicate > 0 && <li>{result.skipped.duplicate.toLocaleString("en-GB")} rows combined with an earlier row for the same person</li>}
            {result.skipped.suppressed > 0 && <li>{result.skipped.suppressed.toLocaleString("en-GB")} skipped: deleted before</li>}
            {result.skipped.invalid > 0 && <li>{result.skipped.invalid.toLocaleString("en-GB")} skipped: no usable name</li>}
            {result.skipped.excluded > 0 && <li>{result.skipped.excluded.toLocaleString("en-GB")} left out by you</li>}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Link href="/people" className="btn-primary">See your people</Link>
            <button type="button" className="btn-secondary" onClick={reset}>Import another file</button>
            {skipped.length > 0 && <button type="button" className="btn-quiet" onClick={() => downloadSkipped(skipped)}>Download skipped rows</button>}
          </div>
          <ImportUndo batchId={result.batchId} fileName={file?.name ?? "your file"} people={result.created} roles={result.rolesCreated} until={until} />
        </section>
      )}
    </div>
  );
}
