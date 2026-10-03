"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWritableFeature } from "@/lib/feature-access";
import type { FormState } from "@/lib/formState";
import { ensureCandidatePerson, personSearchText } from "@/lib/people";
import { purgeExpiredTranscripts } from "@/lib/retention";
import { recordUsage } from "@/lib/usage";
import { parseObjectArray } from "@/lib/json";
import {
  FIELD_LABELS,
  MAX_CV_BYTES,
  MAX_CV_PAGES,
  MAX_TRANSCRIPT_CHARS,
  STALE_CLAIM_MS,
  TRANSCRIPT_RETENTION_DAYS,
  hasValue,
  initialFields,
  monthKey,
  normalizeTranscript,
  pdfPageCount,
  personFactsFrom,
  readFieldForm,
  sameValue,
  screeningMonthlyCap,
} from "@/lib/screening-core.mjs";
import { ScreeningRefusedError, ScreeningShapeError, screeningModel, summariseScreening as callModel } from "@/lib/screening-model.mjs";
import { FIELDS, isFactField, parseSummary, type ScreeningSummary } from "@/lib/screening";
import { canUseFeature } from "@/lib/features";
import { readDate } from "@/lib/talent.mjs";

const DAY_MS = 86_400_000;
// Stages a confirmed screening moves forward from. Later stages are left alone.
const BEFORE_SCREENED = ["sourced", "contacted", "replied", "booking_pending", "booked"];

function revalidateScreening(candidateId: string, roleId: string, personId: string | null) {
  revalidatePath(`/candidates/${candidateId}/screening`);
  revalidatePath(`/roles/${roleId}`);
  if (personId) revalidatePath(`/people/${personId}`);
  revalidatePath("/people");
}

async function ownedCandidate(candidateId: string, ownerId: string) {
  return db.candidate.findFirst({
    where: { id: candidateId, role: { userId: ownerId } },
    select: {
      id: true,
      roleId: true,
      personId: true,
      stage: true,
      role: { select: { title: true, client: true, briefing: { select: { keySkills: true } } } },
    },
  });
}

async function ownedScreening(screeningId: string, ownerId: string) {
  return db.screening.findFirst({
    where: { id: screeningId, candidate: { role: { userId: ownerId } } },
    include: { candidate: { select: { id: true, roleId: true, personId: true, stage: true } } },
  });
}

// The monthly cap is claimed before the call and handed back if the call
// fails, so a recruiter is never charged a generation for an error. The
// conditional update is the guard: two claims at once cannot both pass the cap.
async function claimGeneration(userId: string, now: Date): Promise<boolean> {
  const month = monthKey(now);
  await db.aiUsage.upsert({ where: { userId_month: { userId, month } }, create: { userId, month }, update: {} });
  const { count } = await db.aiUsage.updateMany({
    where: { userId, month, generations: { lt: screeningMonthlyCap() } },
    data: { generations: { increment: 1 } },
  });
  return count === 1;
}

async function refundGeneration(userId: string, now: Date) {
  await db.aiUsage.updateMany({
    where: { userId, month: monthKey(now), generations: { gt: 0 } },
    data: { generations: { decrement: 1 } },
  });
}

async function readTranscript(formData: FormData): Promise<{ text: string; source: "paste" | "upload" | "manual" }> {
  const typed = String(formData.get("transcript") ?? "");
  const file = formData.get("transcriptFile");
  const declared = String(formData.get("source") ?? "");
  if (!typed.trim() && file instanceof File && file.size > 0) {
    // Read on the server too, so the upload works without the page's script.
    return { text: (await file.slice(0, MAX_TRANSCRIPT_CHARS * 4).text()), source: "upload" };
  }
  return { text: typed, source: declared === "upload" ? "upload" : declared === "manual" ? "manual" : "paste" };
}

async function readCv(formData: FormData): Promise<{ base64?: string; error?: string }> {
  const file = formData.get("cv");
  if (!(file instanceof File) || file.size === 0) return {};
  if (file.size > MAX_CV_BYTES) return { error: `That CV is larger than ${Math.round(MAX_CV_BYTES / 1024 / 1024)} MB. Summarise without it, or attach a shorter PDF.` };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pages = pdfPageCount(bytes);
  if (pages === null) return { error: "The CV must be a PDF. Summarise without it, or save it as a PDF first." };
  if (pages > MAX_CV_PAGES) return { error: `That CV has ${pages} pages. Attach one of ${MAX_CV_PAGES} pages or fewer, or summarise without it.` };
  return { base64: Buffer.from(bytes).toString("base64") };
}

// Paste, upload or type notes, then one click sends them for a summary. The
// CV, if attached, goes with that one request and is not kept.
export async function summariseScreening(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("screening");
  const now = new Date();
  await purgeExpiredTranscripts(user.id, now);
  const candidate = await ownedCandidate(String(formData.get("candidateId") ?? ""), user.id);
  if (!candidate) return { error: "That candidate could not be found." };

  const { text, source } = await readTranscript(formData);
  const transcript = normalizeTranscript(text);
  if (!transcript) return { error: "Paste the transcript, upload the file your call app saved, or type your notes first." };
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    return { error: `That transcript is ${transcript.length.toLocaleString("en-GB")} characters; the limit is ${MAX_TRANSCRIPT_CHARS.toLocaleString("en-GB")}. Remove the small talk at the start or end and try again.` };
  }
  const cv = await readCv(formData);
  if (cv.error) return { error: cv.error };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "No API key is set on the server. Add ANTHROPIC_API_KEY and restart." };
  }

  // One open screening per candidate: the draft is reused, so a failed
  // summary can be tried again without pasting everything a second time.
  const open = await db.screening.findFirst({
    where: { candidateId: candidate.id, status: { not: "confirmed" } },
    orderBy: { createdAt: "desc" },
  });
  if (open && open.status === "summarized") {
    return { error: "This candidate already has a summary waiting to be confirmed. Confirm it, or discard it to start again." };
  }
  // A new transcript starts its own 30 days; an old draft's date may already
  // have passed, and would delete this one at once.
  const fresh = { transcript, transcriptSource: source, transcriptDeleteAfter: new Date(now.getTime() + TRANSCRIPT_RETENTION_DAYS * DAY_MS) };
  let screeningId: string;
  if (open) {
    // Claiming and saving the transcript are one conditional write, so a
    // double click cannot pay for two summaries, and a summary in flight
    // never has its transcript replaced underneath it.
    const claimed = await db.screening.updateMany({
      where: {
        id: open.id,
        OR: [{ status: "draft" }, { status: "working", updatedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } }],
      },
      data: { ...fresh, status: "working" },
    });
    if (claimed.count !== 1) return { error: "This screening is already being summarised. Wait a moment and reload the page." };
    screeningId = open.id;
  } else {
    screeningId = (await db.screening.create({ data: { candidateId: candidate.id, ...fresh, status: "working" } })).id;
  }
  const screening = { id: screeningId };

  if (!(await claimGeneration(user.id, now))) {
    await db.screening.update({ where: { id: screening.id }, data: { status: "draft" } });
    return { error: `You have used this month's ${screeningMonthlyCap()} screening summaries. Your transcript is saved; it can be summarised next month, or the limit raised by your administrator.` };
  }

  const keySkills = parseObjectArray<{ skill: string }>(candidate.role.briefing?.keySkills ?? "[]").map((item) => item.skill);
  try {
    const { result, model } = await callModel({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: screeningModel(),
      roleTitle: candidate.role.title,
      client: candidate.role.client,
      keySkills,
      transcript,
      cvBase64: cv.base64,
    });
    const summary = { version: 1, ai: result, fields: initialFields(result) } as ScreeningSummary;
    await db.$transaction(async (tx) => {
      await tx.screening.update({
        where: { id: screening.id },
        data: { status: "summarized", summaryJson: JSON.stringify(summary), summaryModel: model, generatedAt: new Date() },
      });
      const missing = FIELDS.filter((field) => result[field].quote_missing).length;
      await recordUsage(tx, user.id, "quote_missing", null, missing);
    });
  } catch (error) {
    await refundGeneration(user.id, now);
    await db.screening.update({ where: { id: screening.id }, data: { status: "draft" } });
    revalidateScreening(candidate.id, candidate.roleId, candidate.personId);
    if (error instanceof ScreeningRefusedError) return { error: "The summary service declined this transcript. Check it is the right file, or fill the four facts in by hand." };
    if (error instanceof ScreeningShapeError) return { error: "The summary came back in a shape that could not be read. Your transcript is saved; try again." };
    if (error instanceof Anthropic.APIError) return { error: "The summary service could not be reached. Your transcript is saved; try again in a moment." };
    throw error;
  }
  revalidateScreening(candidate.id, candidate.roleId, candidate.personId);
  return {};
}

// One card at a time: the recruiter checks the value against the quote, edits
// it if needed, and confirms it, or marks the fact as not discussed.
export async function confirmScreeningField(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("screening");
  await purgeExpiredTranscripts(user.id);
  const screening = await ownedScreening(String(formData.get("screeningId") ?? ""), user.id);
  const field = String(formData.get("field") ?? "");
  if (!screening || !isFactField(field)) return { error: "That screening could not be found." };
  const summary = parseSummary(screening.summaryJson);
  if (screening.status !== "summarized" || !summary) return { error: "This screening is not waiting for confirmation." };

  const intent = String(formData.get("intent") ?? "confirm");
  const current = summary.fields[field];
  if (intent === "edit") {
    summary.fields[field] = { ...current, confirmed: false } as never;
  } else {
    const notDiscussed = formData.get("not_discussed") === "on";
    const value = readFieldForm(field, (name: string) => formData.get(name));
    if (!notDiscussed && !hasValue(field, value)) {
      return { error: `Enter what they said about ${FIELD_LABELS[field].toLowerCase()}, or tick "Not discussed".` };
    }
    summary.fields[field] = { value, not_discussed: notDiscussed, confirmed: true } as never;
  }
  await db.screening.update({ where: { id: screening.id }, data: { summaryJson: JSON.stringify(summary) } });
  revalidatePath(`/candidates/${screening.candidate.id}/screening`);
  return {};
}

// Nothing reaches the person until all four facts are confirmed. Then the
// facts, the skills and the motivation are written to them in one go, and the
// candidate moves to Screened.
export async function confirmScreening(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireWritableFeature("screening");
  const now = new Date();
  await purgeExpiredTranscripts(user.id, now);
  const screening = await ownedScreening(String(formData.get("screeningId") ?? ""), user.id);
  if (!screening) return { error: "That screening could not be found." };
  const summary = parseSummary(screening.summaryJson);
  if (screening.status !== "summarized" || !summary) return { error: "This screening is not waiting for confirmation." };
  const open = FIELDS.filter((field) => !summary.fields[field].confirmed);
  if (open.length) {
    return { error: `Confirm ${open.map((field) => FIELD_LABELS[field as keyof typeof FIELD_LABELS].toLowerCase()).join(", ")} first.` };
  }

  const personId = await ensureCandidatePerson(screening.candidate.id, user.id);
  if (!personId) return { error: "That candidate could not be found." };
  const skillsSummary = String(formData.get("skillsSummary") ?? "").trim().slice(0, 2000) || null;
  const motivation = String(formData.get("motivation") ?? "").trim().slice(0, 2000) || null;
  const represent = formData.get("represent") === "on";
  // A reminder only where revisit reminders are available; otherwise the
  // fields are not on the page and nothing about them is written.
  const revisit = canUseFeature(user, "revisitReminders")
    ? { revisitOn: readDate(formData.get("revisitOn")), revisitNote: String(formData.get("revisitNote") ?? "").trim().slice(0, 500) || null }
    : null;
  const edited = FIELDS.filter((field) => {
    const ai = summary.ai[field];
    const mine = summary.fields[field];
    return ai.not_discussed !== mine.not_discussed || (!mine.not_discussed && !sameValue(field, ai.value, mine.value));
  }).length;

  const confirmed = await db.$transaction(async (tx) => {
    // Claimed by status, so confirming twice writes once.
    const { count } = await tx.screening.updateMany({
      where: { id: screening.id, status: "summarized" },
      data: { status: "confirmed", confirmedAt: now, representConsentAt: represent ? now : null },
    });
    if (count !== 1) return false;
    const person = await tx.person.findFirstOrThrow({ where: { id: personId, userId: user.id } });
    const facts = personFactsFrom(summary.fields);
    const next = { ...person, ...facts, skillsSummary: skillsSummary ?? person.skillsSummary, motivation: motivation ?? person.motivation };
    await tx.person.update({
      where: { id: person.id },
      data: {
        ...facts,
        skillsSummary: next.skillsSummary,
        motivation: next.motivation,
        factsConfirmedAt: now,
        lastContactAt: now,
        ...(revisit?.revisitOn ? { revisitOn: revisit.revisitOn, revisitNote: revisit.revisitNote } : {}),
        searchText: personSearchText(next),
      },
    });
    await tx.candidate.update({
      where: { id: screening.candidate.id },
      data: {
        lastActivityAt: now,
        ...(BEFORE_SCREENED.includes(screening.candidate.stage) ? { stage: "screened" } : {}),
      },
    });
    await recordUsage(tx, user.id, "screening_confirmed", (now.getTime() - screening.createdAt.getTime()) / 1000);
    await recordUsage(tx, user.id, "ai_field_edited", null, edited);
    return true;
  });
  revalidateScreening(screening.candidate.id, screening.candidate.roleId, personId);
  if (!confirmed) return { error: "This screening was already confirmed." };
  return { notice: "Saved to their record." };
}

export async function discardScreening(formData: FormData) {
  const user = await requireWritableFeature("screening");
  const screening = await ownedScreening(String(formData.get("screeningId") ?? ""), user.id);
  if (!screening || screening.status === "confirmed" || screening.status === "working") return;
  await db.screening.delete({ where: { id: screening.id } });
  revalidateScreening(screening.candidate.id, screening.candidate.roleId, screening.candidate.personId);
}

// Recruiters can remove a transcript before its date; the summary and any
// confirmed facts stay.
export async function deleteTranscript(formData: FormData) {
  const user = await requireWritableFeature("screening");
  const screening = await ownedScreening(String(formData.get("screeningId") ?? ""), user.id);
  if (!screening || screening.status === "working") return;
  await db.screening.update({ where: { id: screening.id }, data: { transcript: null } });
  revalidateScreening(screening.candidate.id, screening.candidate.roleId, screening.candidate.personId);
}
