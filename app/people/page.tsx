import Link from "next/link";
import { db } from "@/lib/db";
import { requireFeature, featureAvailability } from "@/lib/feature-access";
import { formatWhen } from "@/lib/dates";
import { StageBadge } from "@/components/StageBadge";
import { Icon } from "@/components/Icon";
import { locationText, noticeText, rightToWorkText, salaryText } from "@/lib/fact-labels";
import { factsAreStale, hasFactFilters, parsePeopleFilters, reviewCutoff } from "@/lib/talent.mjs";
import { peopleWhere } from "@/lib/people-search";
import { loadMatchPage } from "@/lib/match-page";
import { PeopleBox } from "@/components/PeopleBox";
import { InstantMatch } from "@/components/match/InstantMatch";
import { ImportUndo } from "@/components/ImportUndo";
import { recentBatch } from "@/lib/people-import-server";
import { undoUntil } from "@/lib/people-import-fields.mjs";

export const dynamic = "force-dynamic";

// Everyone this workspace has recorded, once each, however many roles they
// were considered for, under one box. With Instant Match the box starts in
// Match: a brief is read into criteria and the match replaces the list, with
// its criteria (c) and the people set aside (x) in the address. Search finds
// people as before: on every plan by name and headline, and with people search
// across everything recorded about them, filtered on the facts they confirmed.
const PAGE_SIZE = 200;

type Params = { q?: string; deleted?: string; salary?: string; notice?: string; remote?: string; rtw?: string; fresh?: string; c?: string; x?: string; role?: string; all?: string };

function factsLine(person: { salaryMin: number | null; salaryMax: number | null; salaryCurrency: string | null; noticeWeeks: number | null; location: string | null; remotePreference: string | null; rightToWork: string | null }) {
  return [
    salaryText(person.salaryMin, person.salaryMax, person.salaryCurrency),
    noticeText(person.noticeWeeks) && `${noticeText(person.noticeWeeks)} notice`,
    locationText(person.location, person.remotePreference),
    rightToWorkText(person.rightToWork),
  ].filter(Boolean);
}

export default async function PeoplePage({ searchParams }: { searchParams: Params }) {
  const { owner, readOnly } = await requireFeature("people");
  const features = await featureAvailability();
  const filters = parsePeopleFilters(searchParams);
  const searching = Boolean(filters.q) || (features.peopleSearch && hasFactFilters(filters));
  const now = new Date();

  const where = peopleWhere(owner.id, filters, features.peopleSearch, now);
  const match = features.instantMatch ? await loadMatchPage(owner, readOnly, searchParams) : null;
  const matching = Boolean(match?.criteria);
  // Match is where a Pro account starts; a search in the address, or a
  // read-only view (which cannot read a brief), starts in Search.
  const initialMode = matching || match?.startRole ? "match" : searching || readOnly ? "search" : "match";

  const cutoff = reviewCutoff(now);
  const lastImport = features.peopleImport && !readOnly ? await recentBatch(owner.id) : null;
  const [found, total, toReview] = await Promise.all([
    db.person.findMany({
      where,
      orderBy: features.peopleSearch && hasFactFilters(filters) ? [{ factsConfirmedAt: "desc" }, { updatedAt: "desc" }] : { updatedAt: "desc" },
      take: PAGE_SIZE,
      select: {
        id: true, fullName: true, headline: true, profileUrl: true, doNotContact: true, updatedAt: true,
        salaryMin: true, salaryMax: true, salaryCurrency: true, noticeWeeks: true, location: true, remotePreference: true, rightToWork: true, factsConfirmedAt: true,
        candidates: {
          orderBy: { lastActivityAt: "desc" },
          select: { id: true, stage: true, lastActivityAt: true, role: { select: { id: true, title: true, status: true } } },
        },
      },
    }),
    db.person.count({ where: { userId: owner.id } }),
    features.privacy
      ? db.person.count({
          where: {
            userId: owner.id,
            updatedAt: { lt: cutoff },
            OR: [{ lastContactAt: null }, { lastContactAt: { lt: cutoff } }],
            candidates: { none: { lastActivityAt: { gte: cutoff } } },
          },
        })
      : 0,
  ]);
  // Without people search, searchText also carries confirmed facts, which this
  // plain search must not reach into, so a match is kept only when the name or
  // headline matches. Lower-casing here keeps SQLite and PostgreSQL alike.
  const needle = filters.q.toLowerCase();
  const people = filters.q && !features.peopleSearch
    ? found.filter((person) => `${person.fullName} ${person.headline ?? ""}`.toLowerCase().includes(needle))
    : found;
  // A shortlist starts here, from one button: the people are chosen on the
  // shortlist page itself, so this list stays a list to read.
  const canShortlist = features.clientShortlists && !readOnly;

  return (
    <div className="min-w-0">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Pipeline / People</p>
          <h1>People</h1>
          <p className="page-description">
            {features.instantMatch
              ? "Paste a job description to find who you already know who fits, or switch to Search to look someone up."
              : "Everyone you have saved, once each, with every role you considered them for."}
          </p>
        </div>
        {!readOnly && (features.peopleImport || toReview > 0 || canShortlist) && (
          <div className="flex flex-wrap gap-2">
            {toReview > 0 && <Link href="/people/review" className="btn-secondary">Review old records <span className="person-count tabular">{toReview}</span></Link>}
            {features.peopleImport && <Link href="/people/import" className="btn-secondary">Import people</Link>}
            {canShortlist && <Link href="/shortlists/new" className="btn-primary"><Icon name="plus" size={16} />New shortlist</Link>}
          </div>
        )}
      </header>

      {lastImport && (
        <ImportUndo key={lastImport.id} compact batchId={lastImport.id} fileName={lastImport.fileName} people={lastImport.createdCount} roles={lastImport.roleCount} until={undoUntil(lastImport.createdAt)} undone={Boolean(lastImport.undoneAt)} />
      )}

      {searchParams.deleted === "1" && (
        <p role="status" className="auth-success mb-6">
          The person and everything recorded about them were deleted. If the same profile is saved again, Retrivr will say it was deleted before.
        </p>
      )}

      <PeopleBox
        canMatch={features.instantMatch}
        canFilter={features.peopleSearch}
        readOnly={readOnly}
        readsLeft={match?.readsLeft ?? 0}
        initialMode={initialMode}
        query={filters.q}
        filters={{ maxSalary: filters.maxSalary, maxNotice: filters.maxNotice, remote: filters.remote, rightToWork: filters.rightToWork, freshMonths: filters.freshMonths }}
        roles={(match?.roles ?? []).filter((role) => role.hasJobDesc).map((role) => ({ id: role.id, title: role.title, client: role.client }))}
        startRole={match?.startRole ?? null}
        hasMatch={matching}
        searchLabel={features.peopleSearch ? "Search people" : "Search people by name"}
        searchPlaceholder={features.peopleSearch ? "Name, skill, place or a confirmed detail" : "Search by name or headline"}
      />

      {matching && match ? <InstantMatch data={match} /> : (<>

      <div className="directory-label">
        <h2>
          {searching ? "Matching people" : "All people"} <span>{searching ? people.length : total}</span>
        </h2>
      </div>

      {people.length === 0 ? (
        <div className="card empty-state">
          <span className="empty-state-icon"><Icon name={searching ? "search" : "people"} size={26} /></span>
          <h3>{searching ? "No one matches that search" : "No people yet"}</h3>
          {searching ? (
            <>
              <p>{features.peopleSearch ? "Try fewer words, or loosen a filter." : "Try part of a name, or a word from their headline."}</p>
              <Link href="/people" className="btn-secondary">Clear search</Link>
            </>
          ) : (
            <p>
              People appear here when you add a candidate to a role or save a profile with the browser extension.
              Saving the same profile for another role adds to the same person.
              {features.peopleImport && !readOnly && <> Or <Link href="/people/import" className="underline">import a spreadsheet</Link> you already keep.</>}
            </p>
          )}
        </div>
      ) : (
        <ul className="people-list" aria-label="People">
          {people.map((person) => {
            const latest = person.candidates[0];
            const facts = features.peopleSearch ? factsLine(person) : [];
            return (
              <li key={person.id} className="person-row">
                <div className="person-row-identity">
                  <Link href={`/people/${person.id}`} className="person-row-name">{person.fullName}</Link>
                  {person.headline && <p className="person-row-headline">{person.headline}</p>}
                  {!person.profileUrl && <p className="person-row-headline">No profile link</p>}
                  {facts.length > 0 && (
                    <p className="person-row-facts">
                      {facts.join(" / ")}
                      {factsAreStale(person.factsConfirmedAt, now) && <span className="chip person-stale">May be out of date</span>}
                    </p>
                  )}
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
      {!searching && total > PAGE_SIZE && (
        <p className="section-caption mt-4">Showing the {PAGE_SIZE} most recently updated of {total}. Search to find anyone else.</p>
      )}
      </>)}
    </div>
  );
}
