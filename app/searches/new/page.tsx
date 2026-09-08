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
    <fieldset key={owner.id} disabled={readOnly} className="min-w-0 max-w-2xl">
      <h1 className="mb-2 text-3xl">New search</h1>
      <p className="mb-6 text-ink/70">
        Saved searches open LinkedIn with your keywords filled in. You apply the location and
        industry filters inside LinkedIn, using the checklist saved here.
      </p>
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
