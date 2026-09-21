"use client";

import { peopleSearchUrl } from "@/lib/linkedin";
import { markSearchUsed } from "@/app/actions/searches";

// "Run" opens LinkedIn in a new tab. The search happens there, by the
// recruiter, inside LinkedIn's own interface. The app only builds the URL, or
// reopens the one LinkedIn gave the recruiter for a search they saved there:
// that one carries its own filters, industries included, so there is nothing
// to re-tick when it opens.
export function RunSearchButton({
  searchId,
  keywords,
  searchUrl,
}: {
  searchId: string;
  keywords: string;
  searchUrl?: string | null;
}) {
  const saved = searchUrl?.trim() ?? "";
  const url = saved || (keywords.trim() ? peopleSearchUrl(keywords) : "");
  const disabled = !url;
  return (
    <button
      type="button"
      className="btn-primary"
      disabled={disabled}
      title={
        disabled
          ? "Add keywords to this search, or paste a saved LinkedIn search link, first"
          : saved
            ? "Reopens the search you saved in LinkedIn, with its own filters"
            : undefined
      }
      onClick={() => {
        window.open(url, "_blank", "noopener,noreferrer");
        void markSearchUsed(searchId);
      }}
    >
      {saved ? "Open saved search" : "Run search"}
    </button>
  );
}
