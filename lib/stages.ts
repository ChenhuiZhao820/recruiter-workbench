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
  sourced: "bg-ink/30",
  contacted: "bg-accent/50",
  replied: "bg-accent",
  booking_pending: "bg-ink/50",
  booked: "bg-accent",
  rejected: "bg-ink/20",
  placed: "bg-ink",
};

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}
