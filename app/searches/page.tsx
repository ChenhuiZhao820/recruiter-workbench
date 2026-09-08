import Link from "next/link";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { parseStringArray } from "@/lib/json";
import { formatWhen } from "@/lib/dates";
import { deleteSearch, duplicateSearch, renameSearch } from "@/app/actions/searches";
import { RunSearchButton } from "@/components/RunSearchButton";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { ActionForm } from "@/components/ActionForm";

export const dynamic = "force-dynamic";

export default async function SearchesPage() {
  const { owner, readOnly } = await getWorkspace();
  const searches = await db.savedSearch.findMany({
    where: { userId: owner.id, OR: [{ roleId: null }, { role: { userId: owner.id } }] },
    orderBy: { updatedAt: "desc" },
    include: { role: { select: { id: true, title: true } } },
  });

  const groups = new Map<string, typeof searches>();
  for (const s of searches) {
    const key = s.groupLabel?.trim() || "Ungrouped";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const groupNames = Array.from(groups.keys()).sort((a, b) =>
    a === "Ungrouped" ? 1 : b === "Ungrouped" ? -1 : a.localeCompare(b)
  );

  return (
    <fieldset disabled={readOnly} className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-4">
        <h1 className="text-3xl">Searches</h1>
        {!readOnly && <Link href="/searches/new" className="btn-primary">
          New search
        </Link>}
      </div>
      <p className="mb-6 text-ink/70">
        Run opens LinkedIn in a new tab with your keywords. Apply the saved filters there by
        hand, using each record&apos;s checklist.
      </p>

      {searches.length === 0 ? (
        <div className="card text-ink/70">
          <p>No saved searches yet.</p>
          <p className="mt-2">
            Save a search once and you can re-run it any time without rebuilding it from memory.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupNames.map((groupName) => (
            <section key={groupName} aria-label={groupName}>
              <h2 className="mb-2 font-mono text-sm uppercase tracking-wide text-ink/70">
                {groupName}
              </h2>
              <ul className="space-y-3">
                {groups.get(groupName)!.map((s) => {
                  const industries = parseStringArray(s.industries);
                  const locations = parseStringArray(s.locations);
                  const keywords = [s.keywords, ...parseStringArray(s.titles)]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <li key={s.id} className="card">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{s.name}</span>
                        <span className="text-sm text-ink/60">
                          {s.lastUsedAt ? `last run ${formatWhen(s.lastUsedAt)}` : "never run"}
                        </span>
                      </div>
                      {s.role && (
                        <p className="mt-1 text-sm text-ink/70">
                          For role:{" "}
                          <Link href={`/roles/${s.role.id}`} className="underline">
                            {s.role.title}
                          </Link>
                        </p>
                      )}
                      {keywords && (
                        <p className="mt-1 text-sm text-ink/80">Keywords: {keywords}</p>
                      )}
                      {(industries.length > 0 || locations.length > 0 || s.filterNotes) && (
                        <div className="mt-2 text-sm">
                          <p className="font-mono text-xs uppercase tracking-wide text-ink/60">
                            Apply these filters in LinkedIn after it opens:
                          </p>
                          <ul className="mt-1 flex flex-wrap gap-2">
                            {locations.map((l, i) => (
                              <li key={`l-${i}`} className="chip">
                                Location: {l}
                              </li>
                            ))}
                            {industries.map((ind, i) => (
                              <li key={`i-${i}`} className="chip">
                                Industry: {ind}
                              </li>
                            ))}
                            {s.filterNotes && <li className="chip">{s.filterNotes}</li>}
                          </ul>
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {readOnly ? <button type="button" className="btn-primary" disabled>Run search</button> : <RunSearchButton searchId={s.id} keywords={keywords} />}
                        <Link href={`/searches/${s.id}/edit`} className="btn-quiet">
                          {readOnly ? "View details" : "Edit"}
                        </Link>
                        <form action={duplicateSearch}>
                          <input type="hidden" name="id" value={s.id} />
                          <button type="submit" className="btn-quiet">
                            Copy
                          </button>
                        </form>
                        <form action={deleteSearch}>
                          <input type="hidden" name="id" value={s.id} />
                          <ConfirmSubmitButton
                            label="Delete"
                            confirmText={`Delete the search "${s.name}"? This cannot be undone.`}
                          />
                        </form>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm text-ink/70">Rename</summary>
                        <ActionForm action={renameSearch} className="mt-2 flex flex-wrap items-end gap-2">
                          <input type="hidden" name="id" value={s.id} />
                          <div className="flex-1">
                            <label htmlFor={`rename-${s.id}`} className="field-label">
                              New name
                            </label>
                            <input
                              id={`rename-${s.id}`}
                              name="name"
                              defaultValue={s.name}
                              required
                              className="field-input"
                            />
                          </div>
                          <button type="submit" className="btn-secondary">
                            Rename
                          </button>
                        </ActionForm>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </fieldset>
  );
}
