"use client";

import { useState } from "react";

export function CopyButton({
  text,
  label = "Copy message",
  className = "btn-primary",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className={className}
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
        {label}
      </button>
      <span role="status" aria-live="polite" className="text-sm text-ink/70">
        {status === "copied" ? "Copied" : status === "failed" ? "Could not copy. Select and copy the text by hand." : ""}
      </span>
    </span>
  );
}
