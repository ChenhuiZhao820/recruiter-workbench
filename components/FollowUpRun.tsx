"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// Small pieces of the follow-up run that need the browser. None of them
// sends, opens or advances anything on its own.

// "Start (6)": the count follows the ticks as they change.
export function StartRunButton({ initial }: { initial: number }) {
  const button = useRef<HTMLButtonElement>(null);
  const [count, setCount] = useState(initial);
  useEffect(() => {
    const form = button.current?.form;
    if (!form) return;
    const read = () => setCount(form.querySelectorAll('input[name="c"]:checked').length);
    read();
    form.addEventListener("change", read);
    return () => form.removeEventListener("change", read);
  }, []);
  return (
    <button ref={button} type="submit" className="btn-primary" disabled={count === 0}>
      Start ({count})
    </button>
  );
}

// Choosing another template re-reads the page so its preview is the real
// rendered message for that person, ticks kept.
export function TemplateSelect({ name, defaultValue, options, label }: { name: string; defaultValue: string; options: { value: string; label: string }[]; label: string }) {
  return (
    <select
      name={name}
      aria-label={label}
      defaultValue={defaultValue}
      className="field-input max-w-sm"
      onChange={(event) => {
        const form = event.currentTarget.form;
        const review = form?.querySelector<HTMLInputElement>('input[name="review"]');
        if (!form || !review) return;
        review.value = "1";
        form.requestSubmit();
      }}
    >
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

const KEY = "capture-followup-run";

// The address is the whole run; keeping the latest one lets Follow-ups offer
// to carry on after an interruption. Browser-only, and harmless when refused.
export function RememberRun({ href, index, total }: { href: string; index: number; total: number }) {
  useEffect(() => {
    try {
      if (index >= total) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify({ href, index, total }));
    } catch {
      // Not remembered; the run itself is unaffected.
    }
  }, [href, index, total]);
  return null;
}

export function ResumeRun() {
  const [run, setRun] = useState<{ href: string; index: number; total: number } | null>(null);
  useEffect(() => {
    try {
      const kept = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (kept && typeof kept.href === "string" && /^\/followups\/run\?/.test(kept.href) && kept.index < kept.total) setRun(kept);
    } catch {
      // Nothing to offer.
    }
  }, []);
  if (!run) return null;
  return (
    <Link href={run.href} className="btn-secondary">
      Continue your run ({run.index + 1} of {run.total})
    </Link>
  );
}
