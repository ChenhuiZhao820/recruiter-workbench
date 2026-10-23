"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A disclosure whose panel floats under its row instead of pushing the row
// apart, closed by Escape or by a press anywhere else. The panel is whatever
// the server rendered, forms and all.
export function PopoverDetails({ summary, summaryClassName, className = "", label, children }: { summary: ReactNode; summaryClassName: string; className?: string; label?: string; children: ReactNode }) {
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const away = (event: MouseEvent) => {
      const details = root.current;
      if (!details?.open || details.contains(event.target as Node)) return;
      // A dialog opened from inside the panel lives outside it, in a portal.
      if ((event.target as Element | null)?.closest?.("dialog")) return;
      details.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      const details = root.current;
      if (event.key !== "Escape" || !details?.open || document.querySelector("dialog[open]")) return;
      details.open = false;
      details.querySelector("summary")?.focus();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <details ref={root} className={`toolbar-popover ${className}`.trim()} aria-label={label}>
      <summary className={summaryClassName}>{summary}</summary>
      <div className="toolbar-popover-panel">{children}</div>
    </details>
  );
}
