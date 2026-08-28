import { STAGE_COLORS, STAGE_LABELS, isStage } from "@/lib/stages";

// Stage is always shown as a text label. The colour dot is decoration only.
export function StageBadge({ stage }: { stage: string }) {
  const label = isStage(stage) ? STAGE_LABELS[stage] : stage;
  const color = isStage(stage) ? STAGE_COLORS[stage] : "bg-stone-200";
  return (
    <span className="chip">
      <span aria-hidden="true" className={`mr-1.5 inline-block h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
