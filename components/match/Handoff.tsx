"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { saveMatchSearch } from "@/app/actions/match";
import { peopleSearchUrl } from "@/lib/linkedin";
import { Popover } from "./Popover";
import { recordMatchEvent, type Criteria, type RoleOption } from "./InstantMatch";

// When the database runs out: the same criteria, taken to LinkedIn by the
// recruiter. Capture builds the search and the recruiter runs it - a link
// opened by a click, a string copied for Recruiter's keyword box, or a saved
// search to come back to. Nothing is sent to LinkedIn from here.
export function Handoff({ criteria, encoded, query, roles, defaultRoleId, readOnly, prominent }: {
  criteria: Criteria;
  encoded: string;
  query: string;
  roles: RoleOption[];
  defaultRoleId: string | null;
  readOnly: boolean;
  prominent: boolean;
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  if (!query) return null;

  return (
    <section className={`im-handoff ${prominent ? "is-prominent" : ""}`} aria-labelledby="handoff-heading">
      <div className="im-handoff-copy">
        <p className="page-eyebrow">Not finding them?</p>
        <h2 id="handoff-heading">Look outside your database</h2>
        <p>The same criteria as a LinkedIn search. Capture builds it; you run it in your own account.</p>
      </div>
      <div className="im-handoff-body">
        <code className="im-query">{query}</code>
        <div className="im-handoff-actions">
          <a
            href={peopleSearchUrl(query)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
            onClick={() => recordMatchEvent("match_handoff")}
          >
            Open LinkedIn search<Icon name="external" size={15} />
          </a>
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(query);
                setCopied("copied");
                recordMatchEvent("match_handoff");
              } catch {
                setCopied("failed");
              }
              setTimeout(() => setCopied("idle"), 2500);
            }}
          >
            {copied === "copied" ? <><Icon name="check" size={15} />Copied</> : "Copy for Recruiter"}
          </button>
          <Popover name="Save as a search" className="btn-secondary" disabled={readOnly} title={readOnly ? "Read-only view" : undefined} label="Save as a search">
            {(close) => (
              <ActionForm action={saveMatchSearch} className="im-editor">
                <p className="im-editor-title">Save as a search</p>
                <input type="hidden" name="criteria" value={encoded} />
                <label>
                  <span className="field-label">For the role (optional)</span>
                  <select name="roleId" className="field-input" defaultValue={defaultRoleId ?? ""}>
                    <option value="">No role</option>
                    {roles.map((role) => <option key={role.id} value={role.id}>{role.title}</option>)}
                  </select>
                </label>
                <p className="im-editor-note">
                  Keywords, titles and {criteria.location ? "location" : "notes"} are kept, with the requirements as notes to tick in LinkedIn.
                </p>
                <div className="im-editor-actions">
                  <button type="button" className="btn-quiet" onClick={close}>Close</button>
                  <SubmitButton className="btn-primary im-btn-small" pendingLabel="Saving">Save</SubmitButton>
                </div>
              </ActionForm>
            )}
          </Popover>
        </div>
        <p className="im-fineprint" role="status" aria-live="polite">
          {copied === "failed"
            ? "Could not copy. Select the text above and copy it by hand."
            : "In Recruiter, paste it into Keywords. Industries and filters LinkedIn keeps server-side are yours to tick there."}
        </p>
      </div>
    </section>
  );
}
