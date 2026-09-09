import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { updateRole } from "@/app/actions/roles";
import { ActionForm } from "@/components/ActionForm";

export const dynamic = "force-dynamic";

export default async function EditRolePage({ params }: { params: { id: string } }) {
  const { owner, readOnly } = await getWorkspace();
  const role = await db.role.findUnique({ where: { id: params.id, userId: owner.id } });
  if (!role) notFound();

  return (
    <fieldset disabled={readOnly} className="min-w-0 max-w-4xl">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Roles / Details</p>
          <h1>{readOnly ? "Role details" : "Edit role"}</h1>
          <p className="page-description">Keep the brief, client and role status up to date.</p>
        </div>
      </header>
      <ActionForm action={updateRole} className="card form-panel grid gap-6 sm:grid-cols-2">
        <h2 className="section-heading sm:col-span-2"><span aria-hidden="true" className="section-number">01</span> Role essentials</h2>
        <input type="hidden" name="id" value={role.id} />
        <div>
          <label htmlFor="title" className="field-label">
            Job title
          </label>
          <input id="title" name="title" required defaultValue={role.title} className="field-input" />
        </div>
        <div>
          <label htmlFor="client" className="field-label">
            Client (optional)
          </label>
          <input id="client" name="client" defaultValue={role.client ?? ""} className="field-input" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="jobDesc" className="field-label">
            Job description
          </label>
          <textarea
            id="jobDesc"
            name="jobDesc"
            rows={12}
            defaultValue={role.jobDesc ?? ""}
            className="field-input"
          />
        </div>
        <div>
          <label htmlFor="status" className="field-label">
            Status
          </label>
          <select id="status" name="status" defaultValue={role.status} className="field-input">
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary">
            Save role
          </button>
          <Link href={`/roles/${role.id}`} className="btn-secondary">
            Back to role
          </Link>
        </div>
      </ActionForm>
    </fieldset>
  );
}
