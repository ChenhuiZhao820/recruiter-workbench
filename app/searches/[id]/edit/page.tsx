import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { parseStringArray } from "@/lib/json";
import { SearchForm } from "@/components/SearchForm";

export const dynamic = "force-dynamic";

export default async function EditSearchPage({ params }: { params: { id: string } }) {
  const { owner, readOnly } = await getWorkspace();
  const search = await db.savedSearch.findUnique({
    where: { id: params.id, userId: owner.id, OR: [{ roleId: null }, { role: { userId: owner.id } }] },
  });
  if (!search) notFound();

  // Open roles, plus this search's own role even if it has been closed. Without
  // it the select would fall back to "No role" and saving would wipe the link.
  const roles = await db.role.findMany({
    where: {
      userId: owner.id,
      ...(search.roleId ? { OR: [{ status: "open" }, { id: search.roleId }] } : { status: "open" }),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, client: true, status: true },
  });

  return (
    <fieldset disabled={readOnly} className="min-w-0 max-w-4xl">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Searches / Details</p>
          <h1>{readOnly ? "Search details" : "Edit search"}</h1>
          <p className="page-description">Refine your keywords and keep the next search ready to run.</p>
        </div>
      </header>
      <div className="mb-6 border-l-2 border-accent bg-surface p-5">
        <h2 className="section-heading"><span aria-hidden="true" className="section-number">01</span> Search essentials</h2>
        <p className="section-caption">Keywords open in LinkedIn. Your saved filters stay here as a checklist.</p>
      </div>
      <SearchForm
        roles={roles}
        searchId={search.id}
        initial={{
          name: search.name,
          roleId: search.roleId ?? "",
          groupLabel: search.groupLabel ?? "",
          titles: parseStringArray(search.titles).join(", "),
          keywords: search.keywords,
          industries: parseStringArray(search.industries).join(", "),
          locations: parseStringArray(search.locations).join(", "),
          filterNotes: search.filterNotes ?? "",
        }}
      />
    </fieldset>
  );
}
