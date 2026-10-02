import { FACT_FIELDS } from "./screening-core.mjs";

export type FactField = "salary" | "notice" | "location" | "right_to_work";

export const FIELDS = FACT_FIELDS as FactField[];

export function isFactField(value: string): value is FactField {
  return (FIELDS as string[]).includes(value);
}

export type FactValues = {
  salary: { min: number | null; max: number | null; currency: string | null; note: string | null };
  notice: { weeks: number | null; available_from: string | null; note: string | null };
  location: { location: string | null; remote: string | null; note: string | null };
  right_to_work: { status: string | null; note: string | null };
};

export type AiFact<F extends FactField> = {
  value: FactValues[F];
  evidence: string | null;
  not_discussed: boolean;
  quote_missing: boolean;
};

export type ConfirmedFact<F extends FactField> = {
  value: FactValues[F];
  not_discussed: boolean;
  confirmed: boolean;
};

export type ScreeningSummary = {
  version: 1;
  ai: { [F in FactField]: AiFact<F> } & {
    skills: string[];
    motivation: string | null;
    reason_for_leaving: string | null;
    concerns: string[];
    revisit_hint: string | null;
  };
  fields: { [F in FactField]: ConfirmedFact<F> };
};

// Screening.summaryJson is written only by app/actions/screening.ts, after
// validation; anything that does not read back as that shape is treated as
// no summary rather than trusted.
export function parseSummary(json: string | null): ScreeningSummary | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (parsed?.version !== 1 || !parsed.ai || !parsed.fields) return null;
    for (const field of FACT_FIELDS) {
      if (!parsed.ai[field] || !parsed.fields[field] || typeof parsed.fields[field].confirmed !== "boolean") return null;
    }
    return parsed as ScreeningSummary;
  } catch {
    return null;
  }
}
