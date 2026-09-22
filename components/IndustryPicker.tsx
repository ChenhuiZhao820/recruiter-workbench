"use client";

import { useMemo, useState } from "react";
import {
  INDUSTRIES,
  matchIndustries,
  parseIndustries,
  serializeIndustries,
  type Industry,
  type SavedIndustry,
} from "@/lib/linkedin-industries";

// The recruiter types what they mean; they pick from what LinkedIn actually
// has. What gets saved is LinkedIn's own id and its exact label, so nobody has
// to translate the taxonomy again later - not here, and not in Recruiter.
export function IndustryPicker({ name, initial }: { name: string; initial: string }) {
  const [chosen, setChosen] = useState<SavedIndustry[]>(() => parseIndustries(initial));
  const [query, setQuery] = useState("");

  const suggestions = useMemo(() => {
    if (!query.trim()) return [];
    const taken = new Set(chosen.map((c) => c.id).filter(Boolean));
    return matchIndustries(query, 8).filter((i) => !taken.has(i.id));
  }, [query, chosen]);

  // Entries saved before the picker existed are the recruiter's own words with
  // no LinkedIn id behind them. They still work as a note, but they cannot be
  // put into a search, so offer the real entries rather than silently dropping them.
  const unmatched = chosen.filter((c) => !c.id);

  function add(industry: Industry, replacing?: SavedIndustry) {
    setChosen((current) => {
      const without = replacing ? current.filter((c) => c !== replacing) : current;
      if (without.some((c) => c.id === industry.id)) return without;
      return [...without, { id: industry.id, label: industry.label }];
    });
    setQuery("");
  }

  function remove(entry: SavedIndustry) {
    setChosen((current) => current.filter((c) => c !== entry));
  }

  return (
    <div>
      <input type="hidden" name={name} value={serializeIndustries(chosen)} />
      <label htmlFor="s-industry-search" className="field-label">
        Industries (LinkedIn&apos;s own list)
      </label>
      <input
        id="s-industry-search"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="field-input"
        autoComplete="off"
        placeholder="Type how you say it - manufacturing, pharma, logistics"
      />
      <p className="mt-1 text-sm text-ink-soft">
        Pick the entries LinkedIn recognises. They go straight into an ordinary LinkedIn
        search, and they are the exact names to paste into Recruiter&apos;s own filter.
      </p>

      {suggestions.length > 0 && (
        <ul className="mt-2 divide-y divide-line border border-line bg-surface">
          {suggestions.map((industry) => (
            <li key={industry.id}>
              <button
                type="button"
                onClick={() => add(industry)}
                className="block w-full px-3 py-2 text-left hover:bg-paper"
              >
                <span className="font-medium">{industry.label}</span>
                <span className="block font-mono text-xs text-ink/50">{industry.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {query.trim() && suggestions.length === 0 && (
        <p className="mt-2 text-sm text-ink/70">
          Nothing in LinkedIn&apos;s {INDUSTRIES.length} industries matches that. Try a broader
          word - the group names (Manufacturing, Financial Services) bring up everything beneath them.
        </p>
      )}

      {chosen.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {chosen.map((entry, index) => (
            <li key={`${entry.id ?? "free"}-${index}`} className="chip">
              {entry.label}
              {!entry.id && <span className="ml-1 text-ink/50">(not a LinkedIn industry)</span>}
              <button
                type="button"
                onClick={() => remove(entry)}
                aria-label={`Remove ${entry.label}`}
                className="ml-2 text-ink/60 hover:text-ink"
              >
                x
              </button>
            </li>
          ))}
        </ul>
      )}

      {unmatched.map((entry, index) => {
        const options = matchIndustries(entry.label, 4);
        if (options.length === 0) return null;
        return (
          <div key={`u-${index}`} className="mt-3 border-l-2 border-accent pl-3 text-sm">
            <p className="text-ink/80">
              &quot;{entry.label}&quot; is your wording, not LinkedIn&apos;s. Closest matches:
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="btn-quiet"
                  onClick={() => add(option, entry)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
