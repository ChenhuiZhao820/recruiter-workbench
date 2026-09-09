import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { SearchForm } from "@/components/SearchForm";

export const dynamic = "force-dynamic";

export default async function NewSearchPage({
  searchParams,
}: {
  searchParams: { roleId?: string; titles?: string; companies?: string; name?: string };
}) {
  const { owner, readOnly } = await getWorkspace();
  const roles = await db.role.findMany({
    where: {
      userId: owner.id,
      ...(searchParams.roleId
        ? { OR: [{ status: "open" }, { id: searchParams.roleId }] }
        : { status: "open" }),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, client: true, status: true },
  });

  return (
    <fieldset key={owner.id} disabled={readOnly} className="min-w-0 max-w-4xl">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Searches / Create</p>
          <h1>New search</h1>
          <p className="page-description">Save the search. Skip the rebuild.</p>
        </div>
      </header>
      <div className="mb-6 border-l-2 border-accent bg-surface p-5">
        <h2 className="section-heading"><span aria-hidden="true" className="section-number">01</span> Search essentials</h2>
        <p className="section-caption">Saved searches open LinkedIn with your keywords filled in. You apply the location and
        industry filters inside LinkedIn, using the checklist saved here.</p>
      </div>
      <SearchForm
        roles={roles}
        initial={{
          name: searchParams.name ?? "",
          roleId: roles.some((role) => role.id === searchParams.roleId) ? searchParams.roleId : "",
          titles: searchParams.titles ?? "",
          filterNotes: searchParams.companies
            ? `Target companies: ${searchParams.companies}`
            : "",
        }}
      />
    </fieldset>
  );
}
