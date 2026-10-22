import Link from "next/link";
import type { SavedSearch } from "@prisma/client";
import { parseStringArray } from "@/lib/json";
import { industryIds, parseIndustries } from "@/lib/linkedin-industries";
import { formatWhen } from "@/lib/dates";
import { deleteSearch, duplicateSearch } from "@/app/actions/searches";
import { CopyButton } from "@/components/CopyButton";
import { RunSearchButton } from "@/components/RunSearchButton";
import { ConfirmActionButton } from "@/components/CandidateDialogs";
import { Icon } from "@/components/Icon";

// One saved search, laid out like a candidate's row on a role page: the name
// with its pencil, duplicate and bin beside it, what it looks for below, and
// LinkedIn's mark to run it. Shared by the search library and a role's own
// searches, which leaves out the role it is already on.
export function SearchRow({
  search: s,
  readOnly,
  role,
}: {
  search: SavedSearch;
  readOnly: boolean;
  role?: { id: string; title: string } | null;
}) {
  const industries = parseIndustries(s.industries);
  const locations = parseStringArray(s.locations);
  const keywords = [s.keywords, ...parseStringArray(s.titles)].filter(Boolean).join(" ");
  const hasFilters = industries.length > 0 || locations.length > 0;
  return (
    <li className="card search-row">
      <div className="candidate-row-title">
        <span className="person-row-name">{s.name}</span>
        <Link
          href={`/searches/${s.id}/edit`}
          className="row-icon-button hover-tip"
          aria-label={readOnly ? `View details of ${s.name}` : `Edit ${s.name}`}
          data-tip={readOnly ? "View details" : "Edit or rename"}
        >
          <Icon name={readOnly ? "eye" : "pencil"} size={15} />
        </Link>
        <form action={duplicateSearch} className="contents">
          <input type="hidden" name="id" value={s.id} />
          <button type="submit" className="row-icon-button hover-tip" aria-label={`Duplicate ${s.name}`} data-tip="Duplicate">
            <Icon name="duplicate" size={15} />
          </button>
        </form>
        <ConfirmActionButton
          action={deleteSearch}
          fields={{ id: s.id }}
          title={`Delete ${s.name}?`}
          body="The search goes from your library. Nothing changes in LinkedIn. This cannot be undone."
          pendingLabel="Deleting…"
          className="row-icon-button is-danger"
          label={`Delete ${s.name}`}
          tip="Delete"
        >
          <Icon name="trash" size={15} />
        </ConfirmActionButton>
      </div>
      <p className="candidate-row-meta">
        {role && (
          <span>
            For&nbsp;<Link href={`/roles/${role.id}`} className="search-row-role">{role.title}</Link>
          </span>
        )}
        <span>{s.lastUsedAt ? `last run ${formatWhen(s.lastUsedAt)}` : "never run"}</span>
        {s.searchUrl && <span>saved in LinkedIn</span>}
      </p>

      {(keywords || hasFilters || s.filterNotes) && (
        <dl className="search-row-facts">
          {keywords && <>
            <dt>Keywords</dt>
            <dd>{keywords}</dd>
          </>}
          {hasFilters && <>
            <dt>Filters</dt>
            <dd>
              <ul className="search-filters">
                {locations.map((l, i) => (
                  <li key={`l-${i}`}>Location: {l}</li>
                ))}
                {industries.map((ind, i) => (
                  <li key={`i-${i}`}>Industry: {ind.label}</li>
                ))}
                {industries.length > 0 && (
                  <li className="search-filters-copy">
                    <CopyButton
                      className="row-icon-button"
                      label="Copy industries for Recruiter"
                      icon={<Icon name="clipboard" size={15} />}
                      text={industries.map((i) => i.label).join("\n")}
                    />
                  </li>
                )}
              </ul>
            </dd>
          </>}
          {s.filterNotes && <>
            <dt>Notes</dt>
            <dd>{s.filterNotes}</dd>
          </>}
        </dl>
      )}

      <div className="candidate-row-actions search-row-actions">
        <RunSearchButton
          readOnly={readOnly}
          searchId={s.id}
          keywords={keywords}
          industryIds={industryIds(industries)}
          searchUrl={s.searchUrl}
          hasRunBefore={Boolean(s.lastUsedAt)}
        />
      </div>
    </li>
  );
}
