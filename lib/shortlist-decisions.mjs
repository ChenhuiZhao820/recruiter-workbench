// What a client may answer about one person on their page. Kept apart from
// shortlist-core.mjs, which signs links with node:crypto, so the page's own
// buttons can use the same lists in the browser.

export const DECISIONS = ["interview", "declined"];
export const DECISION_REASONS = ["salary", "experience", "location", "notice", "other"];
export const DECISION_REASON_LABELS = { salary: "Salary", experience: "Experience", location: "Location", notice: "Notice period", other: "Something else" };
export const DECISION_NOTE_LIMIT = 280;
