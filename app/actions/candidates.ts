"use server";

import { db } from "@/lib/db";
import { requireWritableWorkspace } from "@/lib/workspace";
import type { FormState } from "@/lib/formState";
import { isStage } from "@/lib/stages";
import { normalizeProfileUrl } from "@/lib/urls";
import { findOrCreatePerson, isSuppressed, personSearchText } from "@/lib/people";
import { canonicalProfileUrl, cleanEmail, cleanMemberId } from "@/lib/person-keys.mjs";
import { revalidatePath } from "next/cache";
import { assertUsable, MAX_FILE_BYTES, readWorkbook, SheetError } from "@/lib/sheet-read.mjs";
import { cleanRows, prepareTable } from "@/lib/people-import.mjs";

function revalidateCandidate(roleId: string) {
  revalidatePath(`/roles/${roleId}`);
  revalidatePath("/followups");
  revalidatePath("/people");
  revalidatePath("/");
}

// A person left with no candidacies and nothing else recorded about them is
// an artefact of an edit, not a record anyone kept, so it is removed.
async function dropIfOrphan(personId: string | null) {
  if (!personId) return;
  await db.person.deleteMany({
    where: { id: personId, candidates: { none: {} }, notes: { none: {} }, factsConfirmedAt: null, email: null, doNotContact: false },
  });
}

export async function addCandidate(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableWorkspace();
  const roleId = String(formData.get("roleId") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  if (!roleId) return { error: "That role could not be found." };
  if (!fullName) return { error: "Enter the candidate's name before adding them." };
  const role = await db.role.findUnique({ where: { id: roleId, userId: user.id }, select: { id: true } });
  if (!role) return { error: "That role could not be found." };

  const profileUrl = normalizeProfileUrl(String(formData.get("profileUrl") ?? ""));

  // The same profile link twice in one role is the same person twice, which
  // is exactly the double-outreach the follow-up guard exists to prevent.
  if (profileUrl) {
    const existing = await db.candidate.findFirst({
      where: { roleId, role: { userId: user.id }, profileUrl },
      select: { fullName: true },
    });
    if (existing) {
      return {
        error: `${existing.fullName} is already on this role with that profile link. Nothing was added.`,
      };
    }
  }

  const headline = String(formData.get("headline") ?? "").trim() || null;
  const suppressed = await isSuppressed(db, user.id, { profileUrl });
  const person = await db.$transaction(async (tx) => {
    const person = await findOrCreatePerson(tx, user.id, { fullName, profileUrl, headline });
    await tx.candidate.create({
      data: {
        role: { connect: { id: roleId, userId: user.id } },
        person: { connect: { id: person.id } },
        fullName,
        profileUrl,
        headline,
        notes: String(formData.get("notes") ?? "").trim() || null,
      },
    });
    return person;
  });
  revalidateCandidate(roleId);

  // Reported, not refused: whether someone may be contacted again is the
  // recruiter's call, but it should not be made without knowing.
  if (person.doNotContact) {
    return { notice: `${fullName} added. They are marked do not contact - check before reaching out.` };
  }
  if (suppressed) {
    return {
      notice: `${fullName} added. This profile was deleted from your workspace before - check they have agreed to be contacted again.`,
    };
  }

  const sameName = await db.candidate.count({ where: { roleId, role: { userId: user.id }, fullName } });
  if (sameName > 1) {
    return {
      notice: `Added. Note that this role already had someone called ${fullName} — check you have not added the same person twice.`,
    };
  }
  return { notice: `${fullName} added.` };
}

export async function updateCandidate(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableWorkspace();
  const id = String(formData.get("id") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  if (!id) return { error: "That candidate could not be found." };
  if (!fullName) return { error: "A candidate needs a name. Nothing was saved." };

  // The row's edit dialog also carries the person's email. Typed or cleared
  // there it is the recruiter's own, as on the person page; left as it was,
  // it is not written, so a link now pointing at someone else does not hand
  // them the last person's address, and a found email keeps its source.
  const typedEmail = String(formData.get("email") ?? "").trim();
  const emailEdited = formData.has("email") && typedEmail !== String(formData.get("emailWas") ?? "").trim();
  const email = typedEmail ? cleanEmail(typedEmail) : null;
  if (emailEdited && typedEmail && !email) return { error: "That does not look like an email address. Nothing was saved." };

  const profileUrl = normalizeProfileUrl(String(formData.get("profileUrl") ?? ""));
  const current = await db.candidate.findUnique({
    where: { id, role: { userId: user.id } },
    select: { roleId: true, personId: true, memberId: true },
  });
  if (!current) return { error: "That candidate could not be found." };

  if (profileUrl) {
    const clash = await db.candidate.findFirst({
      where: { roleId: current.roleId, role: { userId: user.id }, profileUrl, NOT: { id } },
      select: { fullName: true },
    });
    if (clash) {
      return {
        error: `${clash.fullName} already has that profile link on this role. Nothing was saved.`,
      };
    }
  }

  const headline = String(formData.get("headline") ?? "").trim() || null;
  const candidate = await db.$transaction(async (tx) => {
    // The link may now point at a different person; the candidacy follows it.
    // With no link or member id there is nothing to recognise anyone by, and a
    // new person on every save would leave what was kept on the last one (an
    // email, notes) behind, so the candidate keeps the person they have.
    const identified = canonicalProfileUrl(profileUrl) || cleanMemberId(current.memberId);
    const own = !identified && current.personId ? await tx.person.findFirst({ where: { id: current.personId, userId: user.id } }) : null;
    const person = own
      ? await tx.person.update({ where: { id: own.id }, data: { fullName, headline, searchText: personSearchText({ ...own, fullName, headline }) } })
      : await findOrCreatePerson(tx, user.id, { fullName, profileUrl, memberId: current.memberId, headline });
    if (emailEdited && person.email !== email) {
      await tx.person.update({
        where: { id: person.id, userId: user.id },
        data: { email, emailSource: email ? "manual" : null, emailConsentAt: null },
      });
    }
    return tx.candidate.update({
      where: { id, role: { userId: user.id } },
      data: {
        fullName,
        profileUrl,
        headline,
        notes: String(formData.get("notes") ?? "").trim() || null,
        person: { connect: { id: person.id } },
      },
    });
  });
  if (current.personId !== candidate.personId) await dropIfOrphan(current.personId);
  revalidateCandidate(candidate.roleId);
  if (candidate.personId) revalidatePath(`/people/${candidate.personId}`);
  return { notice: "Changes saved." };
}

export async function setCandidateStage(formData: FormData) {
  const user = await requireWritableWorkspace();
  const id = String(formData.get("id") ?? "");
  const stage = String(formData.get("stage") ?? "");
  if (!id || !isStage(stage)) return;
  const candidate = await db.candidate.update({
    where: { id, role: { userId: user.id } },
    data: { stage, lastActivityAt: new Date() },
  });
  revalidateCandidate(candidate.roleId);
}

export async function deleteCandidate(formData: FormData) {
  const user = await requireWritableWorkspace();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const candidate = await db.candidate.delete({ where: { id, role: { userId: user.id } } });
  await dropIfOrphan(candidate.personId);
  revalidateCandidate(candidate.roleId);
}

// Importing a role's candidates from a client's file. The client's columns are
// matched to ours by heading (and by what the cells hold, as the People import
// does); a column of theirs we have no field for is left out, and a field of
// ours their file has no column for stays empty. Nothing is guessed beyond the
// four things a candidate row holds: name, profile link, headline, notes.
export type CsvImportState = FormState & { added?: number; skipped?: { existing: number; noName: number; repeated: number }; ignored?: string[] };

export async function importCandidatesCsv(_prev: CsvImportState, formData: FormData): Promise<CsvImportState> {
  const user = await requireWritableWorkspace();
  const roleId = String(formData.get("roleId") ?? "");
  const role = roleId ? await db.role.findUnique({ where: { id: roleId, userId: user.id }, select: { id: true } }) : null;
  if (!role) return { error: "That role could not be found." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file first." };
  if (file.size > MAX_FILE_BYTES) return { error: `That file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB. Split it into smaller files.` };

  let prepared;
  try {
    const { sheets } = readWorkbook(new Uint8Array(await file.arrayBuffer()));
    prepared = prepareTable(sheets);
    assertUsable(sheets[prepared.sheetIndex], prepared.table.body.length);
  } catch (error) {
    if (error instanceof SheetError) return { error: error.message };
    throw error;
  }
  if (prepared.needsName) return { error: "No column in that file looks like a name, so nobody was added. Name a column \"Name\" or \"Full name\" and try again." };

  // Fields a candidate has; everything else in the file is theirs alone.
  const OURS = new Set(["fullName", "firstName", "lastName", "profileUrl", "headline", "company", "notes"]);
  const mapping = prepared.mapping.map((field) => (OURS.has(field) ? field : ""));
  const ignored = prepared.header.filter((label, column) => !mapping[column] && String(label).trim());
  const rows = cleanRows(prepared.body, prepared.header, mapping, { swapNames: prepared.style.swap, fixCase: prepared.style.fixCase, keepOther: false, nameFromEmail: false });

  const onRole = new Set((await db.candidate.findMany({ where: { roleId, role: { userId: user.id }, profileUrl: { not: null } }, select: { profileUrl: true } })).map((c) => c.profileUrl));
  const skipped = { existing: 0, noName: 0, repeated: 0 };
  const seen = new Set<string>();
  const fresh: { name: string; profileUrl: string | null; headline: string | null; notes: string | null }[] = [];
  for (const row of rows) {
    if (row.error) { skipped.noName += 1; continue; }
    const profileUrl = normalizeProfileUrl(row.profileUrl ?? "");
    if (profileUrl && onRole.has(profileUrl)) { skipped.existing += 1; continue; }
    const key = profileUrl ?? "";
    if (key && seen.has(key)) { skipped.repeated += 1; continue; }
    if (key) seen.add(key);
    fresh.push({ name: row.name, profileUrl, headline: row.headline, notes: row.notes });
  }
  if (fresh.length === 0) return { notice: "Nobody was added: everyone in the file was already on this role or had no name.", added: 0, skipped, ignored };

  await db.$transaction(async (tx) => {
    for (const row of fresh) {
      const person = await findOrCreatePerson(tx, user.id, { fullName: row.name, profileUrl: row.profileUrl, headline: row.headline });
      await tx.candidate.create({
        data: { role: { connect: { id: roleId, userId: user.id } }, person: { connect: { id: person.id } }, fullName: row.name, profileUrl: row.profileUrl, headline: row.headline, notes: row.notes },
      });
    }
  }, { timeout: 60_000, maxWait: 10_000 });
  revalidateCandidate(roleId);
  return { notice: `Added ${fresh.length} ${fresh.length === 1 ? "candidate" : "candidates"}.`, added: fresh.length, skipped, ignored };
}
