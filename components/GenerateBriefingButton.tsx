"use client";

import { useState, useTransition } from "react";
import { generateBriefing } from "@/app/actions/briefing";

export function GenerateBriefingButton({
  roleId,
  hasBriefing,
  hasJobDesc,
}: {
  roleId: string;
  hasBriefing: boolean;
  // The briefing is written from the job description, so without one there is
  // nothing to send. The page already knows this, so say so up front rather
  // than failing after a round trip.
  hasJobDesc: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    startTransition(async () => {
      const result = await generateBriefing(roleId);
      if (!result.ok) setError(result.error);
    });
  };

  const label = pending
    ? "Writing the briefing..."
    : hasBriefing
      ? "Regenerate briefing"
      : "Generate briefing";

  return (
    <div>
      <button
        type="button"
        className="btn-primary"
        onClick={run}
        disabled={pending || !hasJobDesc}
        title={hasJobDesc ? undefined : "Add a job description to this role first"}
      >
        {label}
      </button>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-ink/70">
        {pending ? "This usually takes under a minute." : ""}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-rose-900">
          {error}{" "}
          <button type="button" className="underline" onClick={run}>
            Try again
          </button>
        </p>
      )}
    </div>
  );
}
