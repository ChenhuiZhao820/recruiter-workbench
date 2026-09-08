"use server";

import { db } from "@/lib/db";
import { requireWritableWorkspace } from "@/lib/workspace";
import type { FormState } from "@/lib/formState";
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

function ownedSearch(userId: string) {
  return { userId, OR: [{ roleId: null }, { role: { userId } }] };
}

export async function createSearch(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableWorkspace();
  const { roleId, ...data } = searchDataFrom(formData);
  if (!data.name) return { error: "Give the search a name before creating it." };
  if (roleId && !await db.role.findUnique({ where: { id: roleId, userId: user.id }, select: { id: true } })) {
    return { error: "That role could not be found." };
  }
  await db.savedSearch.create({
    data: {
      ...data,
      user: { connect: { id: user.id } },
      ...(roleId ? { role: { connect: { id: roleId, userId: user.id } } } : {}),
    },
  });
  revalidateSearches(roleId);
  redirect(roleId ? `/roles/${roleId}` : "/searches");
}

export async function updateSearch(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableWorkspace();
  const id = String(formData.get("id") ?? "");
  const { roleId, ...data } = searchDataFrom(formData);
  if (!id) return { error: "That search could not be found." };
  if (!data.name) return { error: "A search needs a name. Nothing was saved." };
  const original = await db.savedSearch.findUnique({ where: { id, ...ownedSearch(user.id) } });
  if (!original) return { error: "That search could not be found." };
  if (roleId && !await db.role.findUnique({ where: { id: roleId, userId: user.id }, select: { id: true } })) {
    return { error: "That role could not be found." };
  }
  await db.savedSearch.update({
    where: { id, ...ownedSearch(user.id) },
    data: { ...data, role: roleId ? { connect: { id: roleId, userId: user.id } } : { disconnect: true } },
  });
  revalidateSearches(original.roleId);
  revalidateSearches(roleId);
  redirect("/searches");
}

export async function duplicateSearch(formData: FormData) {
  const user = await requireWritableWorkspace();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const original = await db.savedSearch.findUnique({ where: { id, ...ownedSearch(user.id) } });
  if (!original) return;
  await db.savedSearch.create({
    data: {
      user: { connect: { id: user.id } },
      name: `${original.name} (copy)`,
      ...(original.roleId ? { role: { connect: { id: original.roleId, userId: user.id } } } : {}),
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

export async function renameSearch(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableWorkspace();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id) return { error: "That search could not be found." };
  if (!name) return { error: "Enter a new name. The search was not renamed." };
  const original = await db.savedSearch.findUnique({ where: { id, ...ownedSearch(user.id) } });
  if (!original) return { error: "That search could not be found." };
  const search = await db.savedSearch.update({ where: { id, ...ownedSearch(user.id) }, data: { name } });
  revalidateSearches(search.roleId);
  return { notice: `Renamed to "${name}".` };
}

export async function deleteSearch(formData: FormData) {
  const user = await requireWritableWorkspace();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const original = await db.savedSearch.findUnique({ where: { id, ...ownedSearch(user.id) } });
  if (!original) return;
  await db.savedSearch.deleteMany({ where: { id, ...ownedSearch(user.id) } });
  revalidateSearches(original.roleId);
}

// Called after the browser opens the LinkedIn tab. Records when the search
// was last used. Makes no request to LinkedIn.
export async function markSearchUsed(id: string) {
  const user = await requireWritableWorkspace();
  const search = await db.savedSearch.update({
    where: { id, ...ownedSearch(user.id) },
    data: { lastUsedAt: new Date() },
  });
  revalidateSearches(search.roleId);
}
