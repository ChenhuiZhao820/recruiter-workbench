"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWritableFeature } from "@/lib/feature-access";
import type { FormState } from "@/lib/formState";
import { parseObjectArray, parseStringArray } from "@/lib/json";
import { recordUsage } from "@/lib/usage";
import { booleanQuery, decodeCriteria, mergeIntoBriefing, money, requirementLabels } from "@/lib/match-core.mjs";

function count(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// Only when the recruiter asks: the criteria join a role's briefing, so the
// role's own "From your database" list and its searches use them too. Skills
// and titles are added, never replaced; the budget changes only if ticked.
export async function saveCriteriaToBriefing(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("instantMatch");
  const criteria = decodeCriteria(String(formData.get("criteria") ?? ""));
  if (!criteria) return { error: "Those criteria could not be read. Start the match again." };
  const role = await db.role.findFirst({
    where: { id: String(formData.get("roleId") ?? ""), userId: user.id, status: "open" },
    select: { id: true, title: true, budgetMin: true, budgetMax: true, briefing: { select: { keySkills: true, searchTitles: true } } },
  });
  if (!role) return { error: "Choose one of your open roles." };

  const merged = mergeIntoBriefing({
    keySkills: parseObjectArray<{ skill: string; real_vs_buzzword: string }>(role.briefing?.keySkills),
    searchTitles: parseStringArray(role.briefing?.searchTitles),
  }, criteria);
  const setBudget = formData.get("setBudget") === "on" && criteria.salaryMax !== null;
  if (!merged.addedSkills.length && !merged.addedTitles.length && !setBudget) {
    return { notice: `${role.title}’s briefing already has all of these skills and titles.` };
  }

  await db.$transaction(async (tx) => {
    const fields = { keySkills: JSON.stringify(merged.keySkills), searchTitles: JSON.stringify(merged.searchTitles) };
    await tx.briefing.upsert({
      where: { roleId: role.id, role: { userId: user.id } },
      update: fields,
      create: {
        ...fields,
        role: { connect: { id: role.id, userId: user.id } },
        dayToDay: "",
        targetCompanies: "[]",
        salaryRange: criteria.salaryMax !== null ? `Up to ${money(criteria.salaryMax, criteria.currency)} (client budget)` : "",
        firstCallQuestions: "[]",
      },
    });
    if (setBudget) {
      await tx.role.update({
        where: { id: role.id, userId: user.id },
        data: {
          budgetMax: criteria.salaryMax,
          budgetCurrency: criteria.currency,
          budgetMin: role.budgetMin !== null && role.budgetMin > criteria.salaryMax! ? null : role.budgetMin,
        },
      });
    }
    await recordUsage(tx, user.id, "match_briefing_saved");
  });
  revalidatePath(`/roles/${role.id}`);

  const parts = [];
  if (merged.addedSkills.length) parts.push(count(merged.addedSkills.length, "key skill"));
  if (merged.addedTitles.length) parts.push(count(merged.addedTitles.length, "title"));
  if (setBudget) parts.push(`a budget up to ${money(criteria.salaryMax!, criteria.currency!)}`);
  return { notice: `Saved to ${role.title}: ${parts.join(", ").replace(/, ([^,]*)$/, " and $1")}.` };
}

// The way out when the database has nobody: the same criteria as a saved
// search, keywords ready to run in LinkedIn, the rest written down as notes to
// re-tick there. Nothing is sent to LinkedIn.
export async function saveMatchSearch(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("instantMatch");
  const criteria = decodeCriteria(String(formData.get("criteria") ?? ""));
  if (!criteria) return { error: "Those criteria could not be read. Start the match again." };
  const roleId = String(formData.get("roleId") ?? "") || null;
  if (roleId && !(await db.role.findFirst({ where: { id: roleId, userId: user.id }, select: { id: true } }))) {
    return { error: "That role could not be found." };
  }
  const notes = [
    ...requirementLabels(criteria).map((label) => label.text),
    ...criteria.nice.map((skill) => `Nice to have: ${skill.name}`),
    ...criteria.unchecked.map((item) => `Check by hand: ${item}`),
  ];
  const name = `${criteria.title || "Instant Match"} search`;
  await db.$transaction(async (tx) => {
    await tx.savedSearch.create({
      data: {
        user: { connect: { id: user.id } },
        ...(roleId ? { role: { connect: { id: roleId, userId: user.id } } } : {}),
        name,
        titles: JSON.stringify([criteria.title, ...criteria.titles].filter(Boolean)),
        keywords: booleanQuery(criteria),
        locations: JSON.stringify(criteria.location ? [criteria.location.name] : []),
        filterNotes: notes.join("\n") || null,
      },
    });
    await recordUsage(tx, user.id, "match_handoff");
  });
  revalidatePath("/searches");
  if (roleId) revalidatePath(`/roles/${roleId}`);
  return { notice: `Saved as “${name}” in Searches${roleId ? ", on the role" : ""}.` };
}
