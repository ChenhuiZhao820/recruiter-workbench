import { createSearch, updateSearch } from "@/app/actions/searches";
import { ActionForm } from "@/components/ActionForm";

type RoleOption = { id: string; title: string; client: string | null; status?: string };

export function SearchForm({
  roles,
  initial,
  searchId,
}: {
  roles: RoleOption[];
  initial: {
    name?: string;
    roleId?: string;
    groupLabel?: string;
    titles?: string;
    keywords?: string;
    industries?: string;
    locations?: string;
    filterNotes?: string;
    searchUrl?: string;
  };
  searchId?: string;
}) {
  return (
    <ActionForm action={searchId ? updateSearch : createSearch} className="card space-y-4">
      {searchId && <input type="hidden" name="id" value={searchId} />}
      <div>
        <label htmlFor="s-name" className="field-label">
          Name
        </label>
        <input
          id="s-name"
          name="name"
          required
          defaultValue={initial.name ?? ""}
          className="field-input"
          placeholder="Ops Director, UK, manufacturing"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="s-role" className="field-label">
            Linked role (optional)
          </label>
          <select id="s-role" name="roleId" defaultValue={initial.roleId ?? ""} className="field-input">
            <option value="">No role</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
                {r.client ? ` (${r.client})` : ""}
                {r.status === "closed" ? " - closed" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="s-group" className="field-label">
            Group (optional)
          </label>
          <input
            id="s-group"
            name="groupLabel"
            defaultValue={initial.groupLabel ?? ""}
            className="field-input"
            placeholder="Client name or role type"
          />
        </div>
      </div>
      <div>
        <label htmlFor="s-titles" className="field-label">
          Job titles (comma separated, used as search keywords)
        </label>
        <input
          id="s-titles"
          name="titles"
          defaultValue={initial.titles ?? ""}
          className="field-input"
          placeholder="Operations Director, Head of Operations"
        />
      </div>
      <div>
        <label htmlFor="s-keywords" className="field-label">
          Extra keywords (optional)
        </label>
        <input
          id="s-keywords"
          name="keywords"
          defaultValue={initial.keywords ?? ""}
          className="field-input"
          placeholder="lean manufacturing"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="s-industries" className="field-label">
            Industries (comma separated, applied by hand in LinkedIn)
          </label>
          <input
            id="s-industries"
            name="industries"
            defaultValue={initial.industries ?? ""}
            className="field-input"
            placeholder="Manufacturing, Logistics"
          />
        </div>
        <div>
          <label htmlFor="s-locations" className="field-label">
            Locations (comma separated, applied by hand in LinkedIn)
          </label>
          <input
            id="s-locations"
            name="locations"
            defaultValue={initial.locations ?? ""}
            className="field-input"
            placeholder="United Kingdom, Manchester"
          />
        </div>
      </div>
      <div>
        <label htmlFor="s-url" className="field-label">
          Saved LinkedIn search link (optional)
        </label>
        <input
          id="s-url"
          name="searchUrl"
          type="url"
          defaultValue={initial.searchUrl ?? ""}
          className="field-input"
          placeholder="https://www.linkedin.com/talent/search?..."
          spellCheck={false}
        />
        <p className="mt-1 text-sm text-ink-soft">
          Industries and most Recruiter filters cannot be put into an address from
          out here — LinkedIn keeps them behind a search of its own. Build the
          filters once in LinkedIn or Recruiter, save the search there, copy the
          address from the browser bar and paste it here. Run search then reopens
          that search with its filters already applied, instead of a plain
          keyword search you have to filter again.
        </p>
      </div>
      <div>
        <label htmlFor="s-notes" className="field-label">
          Other filter notes (optional)
        </label>
        <input
          id="s-notes"
          name="filterNotes"
          defaultValue={initial.filterNotes ?? ""}
          className="field-input"
          placeholder="2nd degree connections only"
        />
      </div>
      <button type="submit" className="btn-primary">
        {searchId ? "Save search" : "Create search"}
      </button>
    </ActionForm>
  );
}
