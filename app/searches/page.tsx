import Link from "next/link";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { SearchRow } from "@/components/SearchRow";
import { SearchGroupActions } from "@/components/SearchGroupDialogs";

export const dynamic = "force-dynamic";

const UNGROUPED = "Ungrouped";

// The search library: one search to a row (SearchRow), in groups whose
// headings rename or delete them. Renaming a search is the Edit page's Name field.
export default async function SearchesPage() {
  const { owner, readOnly } = await getWorkspace();
  const searches = await db.savedSearch.findMany({
    where: { userId: owner.id, OR: [{ roleId: null }, { role: { userId: owner.id } }] },
    orderBy: { updatedAt: "desc" },
    include: { role: { select: { id: true, title: true } } },
  });

  const groups = new Map<string, typeof searches>();
  for (const s of searches) {
    const key = s.groupLabel?.trim() || UNGROUPED;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const groupNames = Array.from(groups.keys()).sort((a, b) =>
    a === UNGROUPED ? 1 : b === UNGROUPED ? -1 : a.localeCompare(b)
  );
  // A heading earns its place only when there is more than one group to tell apart.
  const showGroups = groupNames.length > 1 || groupNames[0] !== UNGROUPED;

  return (
    <fieldset disabled={readOnly} className="min-w-0">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Sourcing / Search library</p>
          <h1>Searches</h1>
          <p className="page-description">Good searches are worth keeping. Pick up exactly where you left off.</p>
        </div>
        {!readOnly && <Link href="/searches/new" className="btn-primary">
          New search
        </Link>}
      </header>

      {searches.length === 0 ? (
        <div className="card empty-state">
          <p className="text-xl font-medium text-ink">No saved searches yet.</p>
          <p className="mt-2">
            Save a search once and you can re-run it any time without rebuilding it from memory.
          </p>
          {!readOnly && <Link href="/searches/new" className="btn-secondary">New search</Link>}
        </div>
      ) : (
        <div className="search-groups">
          {groupNames.map((groupName) => (
            <section key={groupName} aria-label={groupName} className="search-group">
              {showGroups && (
                <div className="search-group-head">
                  <h2 className="search-group-title">
                    {groupName}
                    <span className="tabular">{groups.get(groupName)!.length}</span>
                  </h2>
                  {groupName !== UNGROUPED && <SearchGroupActions group={groupName} count={groups.get(groupName)!.length} />}
                </div>
              )}
              <ul className="search-list">
                {groups.get(groupName)!.map((s) => (
                  <SearchRow key={s.id} search={s} role={s.role} readOnly={readOnly} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </fieldset>
  );
}
