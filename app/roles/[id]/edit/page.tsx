import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { updateRole } from "@/app/actions/roles";

export const dynamic = "force-dynamic";

export default async function EditRolePage({ params }: { params: { id: string } }) {
  const role = await db.role.findUnique({ where: { id: params.id } });
  if (!role) notFound();

  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-3xl">Edit role</h1>
      <form action={updateRole} className="card space-y-4">
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
        <div>
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
      </form>
    </div>
  );
}
