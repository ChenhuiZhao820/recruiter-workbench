import { createRole } from "@/app/actions/roles";

export default function NewRolePage() {
  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-3xl">New role</h1>
      <form action={createRole} className="card space-y-4">
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
        <div>
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
      </form>
    </div>
  );
}
