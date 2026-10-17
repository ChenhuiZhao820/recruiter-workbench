"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireWritableFeature } from "@/lib/feature-access";
import { analyse, applyImport, parseOptions, undoImport, type Analysis, type ImportResult, type Preview, type UndoResult } from "@/lib/people-import-server";
import { MAX_FILE_BYTES, SheetError } from "@/lib/sheet-read.mjs";

export type ImportState = { error?: string; preview?: Preview; result?: ImportResult };
export type UndoState = { error?: string; undo?: UndoResult };

// Two steps over the same file: Preview reads it and says what would happen,
// writing nothing; Import reads it again from the same upload and writes. The
// second step trusts nothing the first one said: it re-reads the file, takes
// every choice made on the page through parseOptions and looks up people and
// roles again, so a page that was edited in the browser cannot import more
// than the file holds or attach anyone to another account's role.

async function read(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an Excel (.xlsx) or CSV file first." } as const;
  if (file.size > MAX_FILE_BYTES) return { error: `That file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB. Split it into smaller files.` } as const;
  let options: unknown = null;
  const raw = form.get("options");
  if (typeof raw === "string" && raw.length <= 200_000) {
    try {
      options = JSON.parse(raw);
    } catch {
      options = null;
    }
  }
  return { bytes: new Uint8Array(await file.arrayBuffer()), options: parseOptions(options), fileName: file.name } as const;
}

function toPreview(analysis: Analysis): Preview {
  const { decided: _decided, placements: _placements, createRoles: _createRoles, ...preview } = analysis;
  void _decided;
  void _placements;
  void _createRoles;
  return preview;
}

export async function previewPeopleImport(form: FormData): Promise<ImportState> {
  const user = await requireWritableFeature("peopleImport");
  const input = await read(form);
  if ("error" in input) return { error: input.error };
  try {
    return { preview: toPreview(await analyse(user.id, input.bytes, input.options)) };
  } catch (error) {
    if (error instanceof SheetError) return { error: error.message };
    throw error;
  }
}

export async function runPeopleImport(form: FormData): Promise<ImportState> {
  const user = await requireWritableFeature("peopleImport");
  if (form.get("confirm") !== "on") return { error: "Tick the box to confirm before importing." };
  const input = await read(form);
  if ("error" in input) return { error: input.error };
  try {
    const analysis = await analyse(user.id, input.bytes, input.options);
    if (analysis.needsName) return { error: "Choose which column holds the name." };
    if (analysis.questions > 0) return { error: "Answer the question above before importing." };
    const result = await applyImport(user.id, analysis, { fileName: input.fileName, fillGaps: form.get("fillGaps") === "on" });
    revalidatePath("/", "layout");
    return { result };
  } catch (error) {
    if (error instanceof SheetError) return { error: error.message };
    // Two imports, or an import and a capture, saved the same profile at once.
    // Nothing was written; reading the file again sees the new record.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "Someone in this file was saved while the import ran, so nothing was written. Preview the file again and import it." };
    }
    throw error;
  }
}

export async function undoPeopleImport(_state: UndoState, form: FormData): Promise<UndoState> {
  const user = await requireWritableFeature("peopleImport");
  const batchId = String(form.get("batchId") ?? "");
  const undo = batchId ? await undoImport(user.id, batchId) : null;
  if (!undo) return { error: "That import can no longer be undone. People can still be deleted one by one from their page." };
  revalidatePath("/", "layout");
  return { undo };
}
