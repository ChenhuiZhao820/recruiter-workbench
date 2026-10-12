"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireWritableFeature } from "@/lib/feature-access";
import { analyse, applyImport, type ImportResult, type Preview } from "@/lib/people-import-server";
import { MAX_FILE_BYTES, SheetError } from "@/lib/sheet-read.mjs";

export type ImportState = { error?: string; preview?: Preview; result?: ImportResult };

// Two steps over the same file: Preview reads it and says what would happen,
// writing nothing; Import reads it again from the same upload and writes. The
// second step trusts nothing the first one said: it re-reads the file, takes
// the column choices as a list of known field names and looks up who already
// exists again, so a page that was edited in the browser cannot import more
// than the file holds.

async function read(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an Excel (.xlsx) or CSV file first." } as const;
  if (file.size > MAX_FILE_BYTES) return { error: `That file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB. Split it into smaller files.` } as const;
  let mapping: unknown = null;
  const raw = form.get("mapping");
  if (typeof raw === "string" && raw) {
    try {
      mapping = JSON.parse(raw);
    } catch {
      mapping = null;
    }
  }
  return { bytes: new Uint8Array(await file.arrayBuffer()), mapping, fileName: file.name } as const;
}

export async function previewPeopleImport(form: FormData): Promise<ImportState> {
  const user = await requireWritableFeature("peopleImport");
  const input = await read(form);
  if ("error" in input) return { error: input.error };
  try {
    const { header, sample, mapping, needsName, totals, rows } = await analyse(user.id, input.bytes, input.mapping);
    return { preview: { header, sample, mapping, needsName, totals, rows } };
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
    const analysis = await analyse(user.id, input.bytes, input.mapping);
    if (analysis.needsName) return { error: "Choose which column holds the name." };
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
