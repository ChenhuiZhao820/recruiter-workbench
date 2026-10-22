"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { setCandidateStage } from "@/app/actions/candidates";
import { STAGES, STAGE_COLORS, STAGE_LABELS, isStage, type Stage } from "@/lib/stages";

// A stage chosen here moves the candidate into another group on the role page,
// so this row is unmounted and a new one mounted under the new heading. What
// was just changed is kept here, outside the component, for the new row to say
// so; it is only ever a few seconds old and lives in this tab alone.
const changed = new Map<string, { stage: string; at: number }>();
const SAID_FOR_MS = 4000;

// The candidate's stage as a menu: open it, pick one, and it is saved. There is
// no separate Set stage button; a line under the menu says it was saved.
export function StageMenu({ candidateId, name, stage }: { candidateId: string; name: string; stage: string }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  // A row mounted for a stage just chosen says so, and is brought into view:
  // it has moved to another part of the page.
  useEffect(() => {
    const recent = changed.get(candidateId);
    if (!recent || recent.stage !== stage || Date.now() - recent.at > SAID_FOR_MS) return;
    changed.delete(candidateId);
    setSaved(stage);
    root.current?.closest("li")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [candidateId, stage]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), SAID_FOR_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>("[aria-selected='true']")?.focus();
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const shown = pending && choice ? choice : stage;
  const label = isStage(shown) ? STAGE_LABELS[shown] : shown;
  const color = isStage(shown) ? STAGE_COLORS[shown] : "#d4d4d8";

  function choose(next: Stage) {
    setOpen(false);
    trigger.current?.focus();
    if (next === stage) return;
    setChoice(next);
    setSaved(null);
    setError("");
    changed.set(candidateId, { stage: next, at: Date.now() });
    startTransition(async () => {
      try {
        const form = new FormData();
        form.set("id", candidateId);
        form.set("stage", next);
        await setCandidateStage(form);
      } catch {
        changed.delete(candidateId);
        setError("The stage was not changed. Try again.");
      }
    });
  }

  function move(event: React.KeyboardEvent<HTMLUListElement>) {
    const options = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const at = options.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      options[(at + step + options.length) % options.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      options[event.key === "Home" ? 0 : options.length - 1]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={root} className="stage-menu">
      <button
        ref={trigger}
        type="button"
        className="stage-menu-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Change stage for ${name}: ${label}`}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        disabled={pending}
      >
        <span aria-hidden="true" className="stage-menu-dot" style={{ background: color }} />
        {label}
        <Icon name="down" size={14} className={open ? "rotate-180" : undefined} />
      </button>
      {open && (
        <ul ref={list} role="listbox" aria-label={`Stage for ${name}`} className="stage-menu-list" onKeyDown={move}>
          {STAGES.map((value) => (
            <li key={value}>
              <button
                type="button"
                role="option"
                aria-selected={value === stage}
                className="stage-menu-option"
                onClick={() => choose(value)}
              >
                <span aria-hidden="true" className="stage-menu-dot" style={{ background: STAGE_COLORS[value] }} />
                {STAGE_LABELS[value]}
                {value === stage && <Icon name="check" size={14} className="ml-auto text-accent" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p role="status" aria-live="polite" className={error ? "stage-menu-note is-error" : "stage-menu-note"}>
        {error || (saved && isStage(saved) ? <><Icon name="check" size={12} />Stage changed to {STAGE_LABELS[saved]}</> : pending ? "Saving…" : "")}
      </p>
    </div>
  );
}
