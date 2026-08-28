export const STAGES = [
  "sourced",
  "contacted",
  "replied",
  "booking_pending",
  "booked",
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
  rejected: "Rejected",
  placed: "Placed",
};

// Colour is decorative only. The text label always appears beside it.
export const STAGE_COLORS: Record<Stage, string> = {
  sourced: "bg-stone-200",
  contacted: "bg-sky-200",
  replied: "bg-emerald-200",
  booking_pending: "bg-amber-200",
  booked: "bg-emerald-300",
  rejected: "bg-rose-200",
  placed: "bg-brass-lite",
};

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}
