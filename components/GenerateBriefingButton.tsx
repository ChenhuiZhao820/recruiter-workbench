"use client";

import { useState, useTransition } from "react";
import { generateBriefing } from "@/app/actions/briefing";

export function GenerateBriefingButton({
  roleId,
  hasBriefing,
}: {
  roleId: string;
  hasBriefing: boolean;
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

  return (
    <div>
      <button type="button" className="btn-primary" onClick={run} disabled={pending}>
        {pending
          ? "Writing the briefing..."
          : hasBriefing
            ? "Regenerate briefing"
            : "Generate briefing"}
      </button>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-ink/70">
        {pending ? "This usually takes under a minute." : ""}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}{" "}
          <button type="button" className="underline" onClick={run}>
            Try again
          </button>
        </p>
      )}
    </div>
  );
}
