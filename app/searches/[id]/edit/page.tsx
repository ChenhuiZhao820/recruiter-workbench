import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { parseStringArray } from "@/lib/json";
import { SearchForm } from "@/components/SearchForm";

export const dynamic = "force-dynamic";

export default async function EditSearchPage({ params }: { params: { id: string } }) {
  const [search, roles] = await Promise.all([
    db.savedSearch.findUnique({ where: { id: params.id } }),
    db.role.findMany({
      where: { status: "open" },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, client: true },
    }),
  ]);
  if (!search) notFound();

  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-3xl">Edit search</h1>
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
    </div>
  );
}
