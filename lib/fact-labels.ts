import type { ConfirmedFact, FactField, FactValues } from "./screening";

// How confirmed facts read on screen, shared by the person page and the
// screening page so a fact looks the same wherever it appears.

export const REMOTE_LABELS: Record<string, string> = {
  onsite: "On site",
  hybrid: "Hybrid",
  remote: "Remote",
  flexible: "Flexible",
};

export const RIGHT_TO_WORK_LABELS: Record<string, string> = {
  has_right: "Has the right to work",
  needs_sponsorship: "Needs sponsorship",
  unknown: "Would not say",
};

export const factDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function money(value: number, currency: string | null) {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP", maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${value.toLocaleString("en-GB")} ${currency ?? ""}`.trim();
  }
}

export function salaryText(min: number | null, max: number | null, currency: string | null) {
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min !== max) return `${money(min, currency)} to ${money(max, currency)} a year`;
  return `${money((min ?? max)!, currency)} a year`;
}

export function noticeText(weeks: number | null) {
  return weeks === null ? null : `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
}

export function locationText(location: string | null, remote: string | null) {
  return [location, remote ? REMOTE_LABELS[remote] ?? remote : null].filter(Boolean).join(", ") || null;
}

export function rightToWorkText(status: string | null) {
  return status ? RIGHT_TO_WORK_LABELS[status] ?? status : null;
}

// One confirmed screening fact as a headline value and an optional note.
export function factSummary(field: FactField, fact: ConfirmedFact<FactField>): { value: string; note: string | null } {
  if (fact.not_discussed) return { value: "Not discussed", note: null };
  if (field === "salary") {
    const v = fact.value as FactValues["salary"];
    return { value: salaryText(v.min, v.max, v.currency) ?? "No annual figure", note: v.note };
  }
  if (field === "notice") {
    const v = fact.value as FactValues["notice"];
    const from = v.available_from ? `Available from ${factDate.format(new Date(`${v.available_from}T00:00:00Z`))}` : null;
    return { value: noticeText(v.weeks) ?? from ?? "No period given", note: [v.weeks !== null ? from : null, v.note].filter(Boolean).join(". ") || null };
  }
  if (field === "location") {
    const v = fact.value as FactValues["location"];
    return { value: locationText(v.location, v.remote) ?? "Not stated", note: v.note };
  }
  const v = fact.value as FactValues["right_to_work"];
  return { value: rightToWorkText(v.status) ?? "Not stated", note: v.note };
}
