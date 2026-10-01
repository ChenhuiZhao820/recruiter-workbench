import Link from "next/link";
import { db } from "@/lib/db";
import { requireFeature } from "@/lib/feature-access";
import { formatWhen } from "@/lib/dates";
import { StageBadge } from "@/components/StageBadge";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

// Everyone this workspace has recorded, once each, however many roles they
// were considered for. Search here is by name only; filtering by what people
// said on a call is a separate feature.
const PAGE_SIZE = 200;

export default async function PeoplePage({ searchParams }: { searchParams: { q?: string; deleted?: string } }) {
  const { owner } = await requireFeature("people");
  const query = (searchParams.q ?? "").trim().slice(0, 120);

  const where = {
    userId: owner.id,
    ...(query ? { searchText: { contains: query.toLowerCase() } } : {}),
  };
  const [found, total] = await Promise.all([
    db.person.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: PAGE_SIZE,
      select: {
        id: true,
        fullName: true,
        headline: true,
        profileUrl: true,
        doNotContact: true,
        updatedAt: true,
        candidates: {
          orderBy: { lastActivityAt: "desc" },
          select: { id: true, stage: true, lastActivityAt: true, role: { select: { id: true, title: true, status: true } } },
        },
      },
    }),
    db.person.count({ where: { userId: owner.id } }),
  ]);
  // searchText also carries confirmed facts, which this plain search must not
  // reach into, so a match is kept only when the name or headline matches.
  // Lower-casing here keeps the behaviour identical on SQLite and PostgreSQL.
  const needle = query.toLowerCase();
  const people = query
    ? found.filter((person) => `${person.fullName} ${person.headline ?? ""}`.toLowerCase().includes(needle))
    : found;

  return (
    <div className="min-w-0">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Pipeline / People</p>
          <h1>People</h1>
          <p className="page-description">
            Everyone you have saved, once each, with every role you considered them for.
          </p>
        </div>
      </header>

      {searchParams.deleted === "1" && (
        <p role="status" className="auth-success mb-6">
          The person and everything recorded about them were deleted. If the same profile is saved again, Capture will say it was deleted before.
        </p>
      )}

      <form method="get" className="directory-toolbar" role="search">
        <div className="search-field">
          <Icon name="search" size={18} />
          <label htmlFor="people-search" className="sr-only">Search people by name</label>
          <input id="people-search" name="q" type="search" defaultValue={query} placeholder="Search by name or headline" />
        </div>
        <button type="submit" className="btn-secondary">Search</button>
      </form>

      <div className="directory-label">
        <h2>
          {query ? "Matching people" : "All people"} <span>{query ? people.length : total}</span>
        </h2>
      </div>

      {people.length === 0 ? (
        <div className="card empty-state">
          <span className="empty-state-icon"><Icon name={query ? "search" : "people"} size={26} /></span>
          <h3>{query ? "No one matches that search" : "No people yet"}</h3>
          {query ? (
            <>
              <p>Try part of a name, or a word from their headline.</p>
              <Link href="/people" className="btn-secondary">Clear search</Link>
            </>
          ) : (
            <p>
              People appear here when you add a candidate to a role or save a profile with the Capture extension.
              Saving the same profile for another role adds to the same person.
            </p>
          )}
        </div>
      ) : (
        <ul className="people-list" aria-label="People">
          {people.map((person) => {
            const latest = person.candidates[0];
            return (
              <li key={person.id} className="person-row">
                <div className="person-row-identity">
                  <Link href={`/people/${person.id}`} className="person-row-name">{person.fullName}</Link>
                  {person.headline && <p className="person-row-headline">{person.headline}</p>}
                  {!person.profileUrl && <p className="person-row-headline">No profile link</p>}
                  {person.doNotContact && <span className="chip person-flag mt-2">Do not contact</span>}
                </div>
                <ul className="person-row-roles" aria-label={`Roles for ${person.fullName}`}>
                  {person.candidates.length === 0 ? (
                    <li className="text-ink-soft">Not on a role</li>
                  ) : (
                    person.candidates.slice(0, 3).map((candidate) => (
                      <li key={candidate.id}>
                        <Link href={`/roles/${candidate.role.id}`} className="person-row-role">{candidate.role.title}</Link>
                        <StageBadge stage={candidate.stage} />
                      </li>
                    ))
                  )}
                  {person.candidates.length > 3 && (
                    <li className="text-ink-soft">and {person.candidates.length - 3} more</li>
                  )}
                </ul>
                <p className="person-row-when tabular">
                  {latest ? <>Last activity {formatWhen(latest.lastActivityAt)}</> : <>Updated {formatWhen(person.updatedAt)}</>}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {!query && total > PAGE_SIZE && (
        <p className="section-caption mt-4">Showing the {PAGE_SIZE} most recently updated of {total}. Search by name to find anyone else.</p>
      )}
    </div>
  );
}
