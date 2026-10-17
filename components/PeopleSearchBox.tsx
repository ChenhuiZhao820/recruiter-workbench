"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { StageBadge } from "@/components/StageBadge";

type Suggestion = {
  id: string;
  name: string;
  headline: string | null;
  doNotContact: boolean;
  role: { title: string; stage: string } | null;
  where: "name" | "headline" | "elsewhere";
};

const FILTER_FIELDS = ["salary", "notice", "remote", "rtw", "fresh"];
const WAIT_MS = 120;

// The typed words, marked where they occur in a line of text.
function highlight(text: string, query: string): ReactNode {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length >= 2);
  if (!words.length) return text;
  const pattern = new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(pattern).map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part));
}

// The People search field. As the recruiter types it suggests the best few
// people, ranked by where the words were found, with the filters already set
// below applied; a suggestion opens that person, and Enter on the field still
// runs the full search. Suggestions are read from this workspace only, through
// /api/people/suggest, and never change anything.
export function PeopleSearchBox({ defaultValue, label, placeholder }: { defaultValue: string; label: string; placeholder: string }) {
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(defaultValue);
  const [results, setResults] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loaded, setLoaded] = useState("");

  // Whatever was typed before the page finished loading is kept, not reset
  // to the address's query.
  useEffect(() => {
    const typed = input.current?.value ?? "";
    if (typed !== defaultValue) {
      setQuery(typed);
      if (document.activeElement === input.current) setOpen(true);
    }
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const words = query.trim();
    if (words.replace(/\s/g, "").length < 2) {
      setResults([]);
      setLoaded("");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ q: words });
      const form = input.current?.form;
      if (form) {
        const data = new FormData(form);
        for (const field of FILTER_FIELDS) {
          const value = String(data.get(field) ?? "").trim();
          if (value) params.set(field, value);
        }
      }
      try {
        const response = await fetch(`/api/people/suggest?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { results: Suggestion[] };
        setResults(body.results);
        setLoaded(words);
        setActive(-1);
      } catch {
        // A newer keystroke cancelled this one, or the network failed: the
        // full search still works, so there is nothing to report.
      }
    }, WAIT_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const showing = open && loaded !== "" && query.trim().replace(/\s/g, "").length >= 2;
  // The last row runs the full search, so it is reachable by keyboard too.
  const rows = results.length + 1;

  function go(index: number) {
    if (index < results.length) {
      setOpen(false);
      router.push(`/people/${results[index].id}`);
    } else {
      setOpen(false);
      input.current?.form?.requestSubmit();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!showing) {
      if (event.key === "ArrowDown" && loaded) setOpen(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (current + 1) % rows);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current <= 0 ? rows - 1 : current - 1));
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      go(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div className="people-suggest">
      <div className="search-field">
        <Icon name="search" size={18} />
        <label htmlFor="people-search" className="sr-only">{label}</label>
        <input
          ref={input}
          id="people-search"
          name="q"
          type="search"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={showing}
          aria-controls={listId}
          aria-activedescendant={showing && active >= 0 ? `${listId}-${active}` : undefined}
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="suggest-panel" data-open={showing} hidden={!showing}>
        <ul id={listId} role="listbox" aria-label="Suggested people">
          {results.map((person, index) => (
            <li
              key={person.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={active === index}
              className="suggest-option"
              style={{ animationDelay: `${index * 18}ms` }}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => go(index)}
            >
              <span className="suggest-main">
                <span className="suggest-name">{highlight(person.name, loaded)}</span>
                {person.headline && <span className="suggest-headline">{highlight(person.headline, loaded)}</span>}
                {person.where === "elsewhere" && <span className="suggest-why">Matched in their skills, notes or confirmed details</span>}
              </span>
              <span className="suggest-side">
                {person.doNotContact ? (
                  <span className="chip person-flag">Do not contact</span>
                ) : person.role ? (
                  <>
                    <span className="suggest-role">{person.role.title}</span>
                    <StageBadge stage={person.role.stage} />
                  </>
                ) : null}
              </span>
            </li>
          ))}
          {results.length === 0 && (
            <li className="suggest-empty" role="option" aria-disabled="true" aria-selected={false}>No one matches yet. Keep typing, or search everything.</li>
          )}
          <li
            id={`${listId}-${results.length}`}
            role="option"
            aria-selected={active === results.length}
            className="suggest-option suggest-all"
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(results.length)}
            onClick={() => go(results.length)}
          >
            <Icon name="search" size={15} />
            <span>See every result for &ldquo;{query.trim()}&rdquo;</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
