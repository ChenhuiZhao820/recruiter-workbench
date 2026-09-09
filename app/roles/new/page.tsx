import { createRole } from "@/app/actions/roles";
import { ActionForm } from "@/components/ActionForm";

import { getWorkspace } from "@/lib/workspace";

export default async function NewRolePage() {
  const { owner, readOnly } = await getWorkspace();
  return (
    <fieldset key={owner.id} disabled={readOnly} className="min-w-0 max-w-4xl">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Roles / Create</p>
          <h1>New role</h1>
          <p className="page-description">Start with the brief. Build your search and candidate pipeline from here.</p>
        </div>
      </header>
      <ActionForm action={createRole} className="card form-panel grid gap-6 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <h2 className="section-heading"><span aria-hidden="true" className="section-number">01</span> Role essentials</h2>
          <p className="section-caption">A clear job description gives your briefing a stronger starting point.</p>
        </div>
        <div>
          <label htmlFor="title" className="field-label">
            Job title
          </label>
          <input id="title" name="title" required className="field-input" placeholder="Operations Director" />
        </div>
        <div>
          <label htmlFor="client" className="field-label">
            Client (optional)
          </label>
          <input id="client" name="client" className="field-input" placeholder="Acme Manufacturing" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="jobDesc" className="field-label">
            Job description (paste it here)
          </label>
          <textarea
            id="jobDesc"
            name="jobDesc"
            rows={12}
            className="field-input"
            placeholder="Paste the full job description. It is used to write the briefing."
          />
        </div>
        <button type="submit" className="btn-primary">
          Create role
        </button>
      </ActionForm>
    </fieldset>
  );
}
