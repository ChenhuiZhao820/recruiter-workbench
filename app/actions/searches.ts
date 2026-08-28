"use server";

import { db } from "@/lib/db";
import { splitList } from "@/lib/json";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function searchDataFrom(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    roleId: String(formData.get("roleId") ?? "").trim() || null,
    groupLabel: String(formData.get("groupLabel") ?? "").trim() || null,
    titles: JSON.stringify(splitList(String(formData.get("titles") ?? ""))),
    keywords: String(formData.get("keywords") ?? "").trim(),
    industries: JSON.stringify(splitList(String(formData.get("industries") ?? ""))),
    locations: JSON.stringify(splitList(String(formData.get("locations") ?? ""))),
    filterNotes: String(formData.get("filterNotes") ?? "").trim() || null,
  };
}

function revalidateSearches(roleId?: string | null) {
  revalidatePath("/searches");
  if (roleId) revalidatePath(`/roles/${roleId}`);
}

export async function createSearch(formData: FormData) {
  const data = searchDataFrom(formData);
  if (!data.name) return;
  await db.savedSearch.create({ data });
  revalidateSearches(data.roleId);
  redirect(data.roleId ? `/roles/${data.roleId}` : "/searches");
}

export async function updateSearch(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const data = searchDataFrom(formData);
  if (!id || !data.name) return;
  await db.savedSearch.update({ where: { id }, data });
  revalidateSearches(data.roleId);
  redirect("/searches");
}

export async function duplicateSearch(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const original = await db.savedSearch.findUnique({ where: { id } });
  if (!original) return;
  await db.savedSearch.create({
    data: {
      name: `${original.name} (copy)`,
      roleId: original.roleId,
      groupLabel: original.groupLabel,
      titles: original.titles,
      keywords: original.keywords,
      industries: original.industries,
      locations: original.locations,
      filterNotes: original.filterNotes,
    },
  });
  revalidateSearches(original.roleId);
}

export async function renameSearch(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;
  const search = await db.savedSearch.update({ where: { id }, data: { name } });
  revalidateSearches(search.roleId);
}

export async function deleteSearch(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const search = await db.savedSearch.delete({ where: { id } });
  revalidateSearches(search.roleId);
}

// Called after the browser opens the LinkedIn tab. Records when the search
// was last used. Makes no request to LinkedIn.
export async function markSearchUsed(id: string) {
  const search = await db.savedSearch.update({
    where: { id },
    data: { lastUsedAt: new Date() },
  });
  revalidateSearches(search.roleId);
}
