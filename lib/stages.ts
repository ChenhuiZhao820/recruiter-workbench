export const STAGES = [
  "sourced",
  "contacted",
  "replied",
  "booking_pending",
  "booked",
  "screened",
  "submitted",
  "interview",
  "rejected",
  "placed",
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  sourced: "Sourced",
  contacted: "Contacted",
  replied: "Replied",
  booking_pending: "Booking pending",
  booked: "Booked",
  screened: "Screened",
  submitted: "Submitted",
  interview: "Client interview",
  rejected: "Rejected",
  placed: "Placed",
};

// Colour is decorative only. The text label always appears beside it. Each
// stage has its own hue, so a glance down a list tells them apart.
export const STAGE_COLORS: Record<Stage, string> = {
  sourced: "#a1a1aa",
  contacted: "#22d3ee",
  replied: "#315cff",
  booking_pending: "#facc15",
  booked: "#a855f7",
  screened: "#84cc16",
  submitted: "#ec4899",
  interview: "#f97316",
  rejected: "#52525b",
  placed: "#16a34a",
};

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}
