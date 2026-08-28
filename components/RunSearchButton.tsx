"use client";

import { peopleSearchUrl } from "@/lib/linkedin";
import { markSearchUsed } from "@/app/actions/searches";

// "Run" opens LinkedIn in a new tab. The search happens there, by the
// recruiter, inside LinkedIn's own interface. The app only builds the URL.
export function RunSearchButton({ searchId, keywords }: { searchId: string; keywords: string }) {
  const disabled = !keywords.trim();
  return (
    <button
      type="button"
      className="btn-primary"
      disabled={disabled}
      title={disabled ? "Add keywords to this search first" : undefined}
      onClick={() => {
        window.open(peopleSearchUrl(keywords), "_blank", "noopener,noreferrer");
        void markSearchUsed(searchId);
      }}
    >
      Run search
    </button>
  );
}
