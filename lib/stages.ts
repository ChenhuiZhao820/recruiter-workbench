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
  sourced: "bg-slate-300",
  contacted: "bg-sky-400",
  replied: "bg-teal-400",
  booking_pending: "bg-amber-400",
  booked: "bg-emerald-500",
  rejected: "bg-rose-400",
  placed: "bg-violet-500",
};

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}
