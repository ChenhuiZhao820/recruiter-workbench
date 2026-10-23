"use client";

import { useFormState } from "react-dom";
import { importCandidatesCsv, type CsvImportState } from "@/app/actions/candidates";
import { SubmitButton } from "@/components/SubmitButton";

// A client's CSV for this role. What the file has that we have no field for is
// left out, and what we have that the file lacks stays empty; the result says
// which of their columns were left out so nothing disappears quietly.
export function ImportCandidatesForm({ roleId }: { roleId: string }) {
  const [state, action] = useFormState<CsvImportState, FormData>(importCandidatesCsv, {});
  const skipped = state.skipped ? [
    state.skipped.existing && `${state.skipped.existing} already on this role`,
    state.skipped.repeated && `${state.skipped.repeated} repeated in the file`,
    state.skipped.noName && `${state.skipped.noName} with no name`,
  ].filter(Boolean) : [];
  return (
    <form action={action} className="card space-y-3">
      <input type="hidden" name="roleId" value={roleId} />
      <div>
        <label htmlFor="import-csv" className="field-label">CSV file</label>
        <input id="import-csv" name="file" type="file" accept=".csv,text/csv,.xlsx" required className="screening-file" />
      </div>
      <p className="settings-hint">
        Their columns are matched to a candidate&rsquo;s name, profile link, headline and notes. A column we have no place for is left out; a field the file has no column for stays empty. Everyone is added as Sourced.
      </p>
      <SubmitButton pendingLabel="Importing…" className="btn-primary">Import candidates</SubmitButton>
      {state.error && <p role="alert" data-form-message="error" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{state.error}</p>}
      {state.notice && (
        <div role="status" data-form-message="notice" className="rounded border border-line bg-surface px-3 py-2 text-sm">
          <p>{state.notice}{skipped.length > 0 && ` Skipped: ${skipped.join(", ")}.`}</p>
          {state.ignored && state.ignored.length > 0 && <p className="settings-hint">Left out, no matching field: {state.ignored.join(", ")}.</p>}
        </div>
      )}
    </form>
  );
}
