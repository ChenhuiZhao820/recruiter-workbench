"use server";

import { db } from "@/lib/db";
import { requireWritableWorkspace } from "@/lib/workspace";
import type { FormState } from "@/lib/formState";
import { splitList } from "@/lib/json";
import { searchLinkProblem, searchLinkUrl } from "@/lib/linkedin";
import { parseIndustries, serializeIndustries } from "@/lib/linkedin-industries";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function searchDataFrom(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    roleId: String(formData.get("roleId") ?? "").trim() || null,
    groupLabel: String(formData.get("groupLabel") ?? "").trim() || null,
    titles: JSON.stringify(splitList(String(formData.get("titles") ?? ""))),
    keywords: String(formData.get("keywords") ?? "").trim(),
    // The picker posts LinkedIn's own entries as JSON. Anything else is a
    // recruiter's free text from before the picker and is kept as a plain label.
    industries: serializeIndustries(industriesFrom(String(formData.get("industries") ?? ""))),
    locations: JSON.stringify(splitList(String(formData.get("locations") ?? ""))),
    filterNotes: String(formData.get("filterNotes") ?? "").trim() || null,
    // Kept as LinkedIn gave it, or not kept at all.
    searchUrl: searchLinkUrl(String(formData.get("searchUrl") ?? "")) || null,
  };
}

function industriesFrom(raw: string) {
  const parsed = parseIndustries(raw);
  if (parsed.length > 0 || raw.trim().startsWith("[")) return parsed;
  return splitList(raw).map((label) => ({ label }));
}

// The pasted address, judged before anything is written.
function linkProblem(formData: FormData): string | null {
  return searchLinkProblem(String(formData.get("searchUrl") ?? ""));
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
  const badLink = linkProblem(formData);
  if (badLink) return { error: badLink };
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
  const badLink = linkProblem(formData);
  if (badLink) return { error: badLink };
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
      searchUrl: original.searchUrl,
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

// Offered on the second run of a search that has no link yet: the recruiter
// saved the search inside LinkedIn and pasted back the address LinkedIn gave
// them. Stored opaquely and never requested from here.
export async function attachSearchLink(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableWorkspace();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "That search could not be found." };
  const problem = linkProblem(formData);
  if (problem) return { error: problem };
  const url = searchLinkUrl(String(formData.get("searchUrl") ?? ""));
  if (!url) return { error: "Paste the LinkedIn address of the search you saved." };
  const original = await db.savedSearch.findUnique({ where: { id, ...ownedSearch(user.id) } });
  if (!original) return { error: "That search could not be found." };
  const search = await db.savedSearch.update({
    where: { id, ...ownedSearch(user.id) },
    data: { searchUrl: url },
  });
  revalidateSearches(search.roleId);
  return { notice: "Saved. Run now reopens that search in LinkedIn, filters and all." };
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
