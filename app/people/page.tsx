import Link from "next/link";
import { db } from "@/lib/db";
import { requireFeature, featureAvailability } from "@/lib/feature-access";
import { formatWhen } from "@/lib/dates";
import { StageBadge } from "@/components/StageBadge";
import { Icon } from "@/components/Icon";
import { locationText, noticeText, rightToWorkText, salaryText, REMOTE_LABELS, RIGHT_TO_WORK_LABELS } from "@/lib/fact-labels";
import { FRESH_MONTHS, REMOTE_FILTERS, RTW_FILTERS, factsAreStale, hasFactFilters, parsePeopleFilters, reviewCutoff } from "@/lib/talent.mjs";
import { peopleWhere } from "@/lib/people-search";
import { PeopleSearchBox } from "@/components/PeopleSearchBox";
import { FilterSummary } from "@/components/FilterSummary";

export const dynamic = "force-dynamic";

// Everyone this workspace has recorded, once each, however many roles they
// were considered for. On every plan the search is by name and headline; with
// people search it reaches everything recorded about a person and can filter
// on the four facts they confirmed.
const PAGE_SIZE = 200;

type Params = { q?: string; deleted?: string; salary?: string; notice?: string; remote?: string; rtw?: string; fresh?: string };

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

  const cutoff = reviewCutoff(now);
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
  const filtersOpen = features.peopleSearch && hasFactFilters(filters);

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
        {toReview > 0 && !readOnly && (
          <Link href="/people/review" className="btn-secondary">Review old records <span className="person-count tabular">{toReview}</span></Link>
        )}
      </header>

      {searchParams.deleted === "1" && (
        <p role="status" className="auth-success mb-6">
          The person and everything recorded about them were deleted. If the same profile is saved again, Capture will say it was deleted before.
        </p>
      )}

      <form method="get" className="people-search" role="search">
        <div className="directory-toolbar">
          <PeopleSearchBox
            defaultValue={filters.q}
            label={features.peopleSearch ? "Search people" : "Search people by name"}
            placeholder={features.peopleSearch ? "Name, skill, place or a confirmed detail" : "Search by name or headline"}
          />
          <button type="submit" className="btn-secondary">Search</button>
        </div>
        {features.peopleSearch && (
          <details className="people-filters" open={filtersOpen}>
            <summary>
              <FilterSummary
                initial={[
                  filters.maxSalary !== null && "salary",
                  filters.maxNotice !== null && "notice",
                  filters.remote && "remote",
                  filters.rightToWork && "rtw",
                  filters.freshMonths && "fresh",
                ].filter((field): field is string => Boolean(field))}
              />
            </summary>
            <div className="people-filter-grid">
              <div>
                <label htmlFor="filter-salary" className="field-label">Salary up to (a year)</label>
                <input id="filter-salary" name="salary" inputMode="numeric" defaultValue={filters.maxSalary ?? ""} placeholder="e.g. 90k" className="field-input tabular" />
              </div>
              <div>
                <label htmlFor="filter-notice" className="field-label">Notice up to (weeks)</label>
                <input id="filter-notice" name="notice" type="number" min={0} max={104} defaultValue={filters.maxNotice ?? ""} className="field-input tabular" />
              </div>
              <div>
                <label htmlFor="filter-remote" className="field-label">Working pattern</label>
                <select id="filter-remote" name="remote" defaultValue={filters.remote ?? ""} className="field-input">
                  <option value="">Any</option>
                  {REMOTE_FILTERS.map((value: string) => <option key={value} value={value}>{REMOTE_LABELS[value]}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="filter-rtw" className="field-label">Right to work</label>
                <select id="filter-rtw" name="rtw" defaultValue={filters.rightToWork ?? ""} className="field-input">
                  <option value="">Any</option>
                  {RTW_FILTERS.map((value: string) => <option key={value} value={value}>{RIGHT_TO_WORK_LABELS[value]}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="filter-fresh" className="field-label">Confirmed within</label>
                <select id="filter-fresh" name="fresh" defaultValue={filters.freshMonths ?? ""} className="field-input">
                  <option value="">Any time</option>
                  {FRESH_MONTHS.map((months: number) => <option key={months} value={months}>{months} months</option>)}
                </select>
              </div>
            </div>
            <p className="section-caption">
              Filters use only facts confirmed on a screening; someone with nothing confirmed for a filter is left out of it.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-secondary">Apply filters</button>
              <Link href="/people" className="btn-quiet">Clear</Link>
            </div>
          </details>
        )}
      </form>

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
              People appear here when you add a candidate to a role or save a profile with the Capture extension.
              Saving the same profile for another role adds to the same person.
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
    </div>
  );
}
