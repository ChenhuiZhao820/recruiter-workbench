"use client";

import { useState, type ReactNode } from "react";

export function CopyButton({
  text,
  label = "Copy message",
  className = "btn-primary",
  hasGaps = false,
  icon,
}: {
  text: string;
  label?: string;
  className?: string;
  // Copying a message with holes in it is allowed - you may want to finish it
  // by hand - but it must never look like a clean copy.
  hasGaps?: boolean;
  // Shown in place of the label, which then names the button and is its tip.
  icon?: ReactNode;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className={icon ? `${className} hover-tip` : className}
        aria-label={icon ? label : undefined}
        data-tip={icon ? label : undefined}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setStatus("copied");
          } catch {
            setStatus("failed");
          }
          setTimeout(() => setStatus("idle"), 2500);
        }}
      >
        {icon ?? label}
      </button>
      <span role="status" aria-live="polite" className="text-sm text-ink/70">
        {status === "copied"
          ? hasGaps
            ? "Copied, but it still has gaps. Fix them before you send it."
            : "Copied"
          : status === "failed"
            ? "Could not copy. Select and copy the text by hand."
            : ""}
      </span>
    </span>
  );
}
