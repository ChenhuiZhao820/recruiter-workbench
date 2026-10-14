"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { undoPeopleImport, type UndoState } from "@/app/actions/people-import";

// Taking an import back, for a week after it ran. Asking happens in place,
// with what will go and what will stay, rather than in a dialog: it is one
// decision about something already on screen.

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

function UndoButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn-secondary" disabled={pending}>{pending ? "Undoing…" : label}</button>;
}

export function ImportUndo({
  batchId,
  fileName,
  people,
  roles,
  until,
  compact = false,
  undone = false,
}: {
  batchId: string;
  fileName: string;
  people: number;
  roles: number;
  until: string;
  compact?: boolean;
  undone?: boolean;
}) {
  const [state, action] = useFormState<UndoState, FormData>(undoPeopleImport, {});
  const [asking, setAsking] = useState(false);

  if (state.undo) {
    const { removedPeople, removedRoles, removedCandidacies, restoredFields, kept } = state.undo;
    return (
      <div role="status" className={compact ? "card mb-6 space-y-1 text-sm" : "space-y-1 text-sm"}>
        <p className="font-medium">Import undone.</p>
        <p className="text-ink-soft">
          Removed {plural(removedPeople, "person", "people")}
          {removedRoles > 0 && `, ${plural(removedRoles, "role", "roles")}`}
          {removedCandidacies > 0 && ` and ${plural(removedCandidacies, "place on a role", "places on roles")} for people who were already here`}
          {restoredFields > 0 && `; emptied ${plural(restoredFields, "field", "fields")} it had filled`}.
        </p>
        {kept.length > 0 && <p className="text-ink-soft">Kept because you have worked with them since: {kept.slice(0, 10).join(", ")}{kept.length > 10 && ` and ${kept.length - 10} more`}.</p>}
      </div>
    );
  }

  if (undone) return null;

  return (
    <div className={compact ? "card mb-6 space-y-2 text-sm" : "space-y-2 border-t border-line pt-3 text-sm"}>
      {!asking ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-ink-soft">
            {compact ? <>Imported {plural(people, "person", "people")} from {fileName}. </> : null}
            You can undo this import until {until}.
          </p>
          <button type="button" className="btn-quiet" onClick={() => setAsking(true)}>Undo import</button>
        </div>
      ) : (
        <form action={action} className="space-y-2">
          <input type="hidden" name="batchId" value={batchId} />
          <p>
            This removes the {plural(people, "person", "people")}
            {roles > 0 && ` and ${plural(roles, "role", "roles")}`} this import added, and anyone it put on a role. People you have contacted, screened, booked, moved on or written a note about since are kept.
          </p>
          {state.error && <p role="alert" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-rose-900">{state.error}</p>}
          <div className="flex flex-wrap gap-2">
            <UndoButton label="Undo import" />
            <button type="button" className="btn-quiet" onClick={() => setAsking(false)}>Keep it</button>
          </div>
        </form>
      )}
    </div>
  );
}
