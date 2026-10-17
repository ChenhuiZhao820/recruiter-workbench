"use client";

import { useEffect, useId, useRef, useState } from "react";

// A small panel under a button: opened by a click, closed by Escape, a click
// elsewhere or the panel's own controls. On a phone it sits at the foot of the
// screen instead, where a thumb can reach it.
export function Popover({
  label,
  name,
  className = "btn-quiet",
  align = "end",
  disabled = false,
  title,
  children,
}: {
  label: React.ReactNode;
  // What the panel is, for a screen reader.
  name: string;
  className?: string;
  align?: "start" | "end";
  disabled?: boolean;
  title?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    const first = root.current?.querySelector<HTMLElement>(".im-popover-panel input:not([type=hidden]), .im-popover-panel select, .im-popover-panel button");
    first?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="im-popover">
      <button
        ref={button}
        type="button"
        className={className}
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        title={title}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      {open && (
        <div id={id} role="dialog" aria-label={name} className={`im-popover-panel ${align === "start" ? "is-start" : ""}`}>
          {children(() => {
            setOpen(false);
            button.current?.focus();
          })}
        </div>
      )}
    </div>
  );
}
