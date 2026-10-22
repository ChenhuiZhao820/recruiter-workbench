"use client";

import { useState } from "react";
import { peopleSearchUrl } from "@/lib/linkedin";
import { attachSearchLink, markSearchUsed } from "@/app/actions/searches";
import { ActionForm } from "@/components/ActionForm";
import { LinkedInLogo } from "@/components/LinkedInLogo";

// "Run" opens LinkedIn in a new tab. The search happens there, by the
// recruiter, inside LinkedIn's own interface. The app only builds the URL - now
// with the picked industries already in it - or reopens the search LinkedIn
// itself saved, which carries filters no address could express.
export function RunSearchButton({
  searchId,
  keywords,
  industryIds = [],
  searchUrl,
  hasRunBefore = false,
  readOnly = false,
}: {
  searchId: string;
  keywords: string;
  industryIds?: string[];
  searchUrl?: string | null;
  hasRunBefore?: boolean;
  readOnly?: boolean;
}) {
  const [offerLink, setOfferLink] = useState(false);
  const saved = searchUrl?.trim() ?? "";
  const url = saved || (keywords.trim() ? peopleSearchUrl(keywords, industryIds) : "");
  const disabled = !url || readOnly;
  const label = saved ? "Open saved search" : "Run search";
  const hint = !url
    ? "Add keywords to this search first"
    : saved
      ? "Reopens the search you saved in LinkedIn, with its own filters"
      : industryIds.length > 0
        ? "Opens LinkedIn with your industries already applied"
        : undefined;

  // LinkedIn's mark, as a candidate row shows it for a profile, with the action
  // named beside it; the tip says what the click will carry.
  return (
    <>
      <button
        type="button"
        className={hint ? "run-search hover-tip" : "run-search"}
        disabled={disabled}
        data-tip={hint}
        onClick={() => {
          window.open(url, "_blank", "noopener,noreferrer");
          void markSearchUsed(searchId);
          // Second run and still no saved link: now it is worth the one paste.
          if (!saved && hasRunBefore) setOfferLink(true);
        }}
      >
        <LinkedInLogo size={24} />
        <span>{label}</span>
      </button>

      {offerLink && (
        <div className="mt-3 w-full border-l-2 border-accent pl-4">
          <p className="text-sm text-ink/80">
            That is the second time you have run this one. If you use Recruiter, save the
            search there once and paste the address LinkedIn gives you - after that, Run
            reopens it with every filter still on, including the ones no address can carry.
          </p>
          <ActionForm action={attachSearchLink} className="mt-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={searchId} />
            <div className="min-w-[16rem] flex-1">
              <label htmlFor={`link-${searchId}`} className="field-label">
                LinkedIn search address
              </label>
              <input
                id={`link-${searchId}`}
                name="searchUrl"
                type="url"
                className="field-input"
                spellCheck={false}
                placeholder="https://www.linkedin.com/talent/search?..."
              />
            </div>
            <button type="submit" className="btn-secondary">
              Save link
            </button>
            <button type="button" className="btn-quiet" onClick={() => setOfferLink(false)}>
              Not now
            </button>
          </ActionForm>
        </div>
      )}
    </>
  );
}
