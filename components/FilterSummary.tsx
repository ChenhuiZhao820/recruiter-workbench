"use client";

import { useEffect, useRef, useState } from "react";

// What each filter is called once it is set, in the order the form shows them.
const NAMES: [string, string][] = [
  ["salary", "salary"],
  ["notice", "notice period"],
  ["remote", "working pattern"],
  ["rtw", "right to work"],
  ["fresh", "how recent"],
];

// The filter panel's own label: "Filter by" until something is set, then the
// filters in use, read from the form as they change, so the closed panel
// still says what is narrowing the list.
export function FilterSummary({ initial = [] }: { initial?: string[] }) {
  const marker = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState<string[]>(() => NAMES.filter(([field]) => initial.includes(field)).map(([, name]) => name));

  useEffect(() => {
    const form = marker.current?.closest("form");
    if (!form) return;
    const read = () => {
      const data = new FormData(form);
      setActive(NAMES.filter(([field]) => String(data.get(field) ?? "").trim()).map(([, name]) => name));
    };
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => {
      form.removeEventListener("input", read);
      form.removeEventListener("change", read);
    };
  }, []);

  return (
    <span ref={marker}>
      Filter by{active.length > 0 && <span className="filter-summary-active"> {active.join(", ")}</span>}
    </span>
  );
}
