"use client";

import { useId, useState } from "react";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { decideShortlistItem } from "@/app/actions/client-decisions";
import { DECISION_NOTE_LIMIT, DECISION_REASONS, DECISION_REASON_LABELS } from "@/lib/shortlist-decisions.mjs";
import type { ClientDecision as Decision } from "@/lib/shortlists";

// The client's two answers about one person: meet them, or not for us with a
// reason. One click for the answer that leads somewhere; a reason chip and an
// optional line for the one that does not. In the recruiter's preview it shows
// the answer and acts on nothing.
export function ClientDecision({ token, itemId, firstName, decision, canDecide }: {
  token: string | null;
  itemId: string;
  firstName: string;
  decision: Decision;
  canDecide: boolean;
}) {
  const id = useId();
  const [changing, setChanging] = useState(false);
  const [declining, setDeclining] = useState(false);
  const interactive = Boolean(token) && canDecide;

  const status = decision ? (
    <p className={`client-decision-status${decision.decision === "interview" ? " is-yes" : ""}`}>
      {decision.decision === "interview"
        ? <>You asked to meet {firstName}. The recruiter will arrange it.</>
        : <>Not for you{decision.reason ? <> &middot; {DECISION_REASON_LABELS[decision.reason as keyof typeof DECISION_REASON_LABELS] ?? decision.reason}</> : null}{decision.note ? <>: <span className="client-decision-note">{decision.note}</span></> : null}</>}
    </p>
  ) : null;

  if (!interactive || (decision && !changing)) {
    return (
      <div className="client-decision">
        {status ?? (token ? null : <p className="client-decision-status">No answer yet.</p>)}
        {interactive && decision && (
          <button type="button" className="btn-quiet" onClick={() => { setDeclining(false); setChanging(true); }}>Change your answer</button>
        )}
      </div>
    );
  }

  return (
    <div className="client-decision">
      {status}
      {!declining ? (
        <div className="client-decision-actions">
          <ActionForm action={decideShortlistItem}>
            <input type="hidden" name="token" value={token!} />
            <input type="hidden" name="itemId" value={itemId} />
            <input type="hidden" name="decision" value="interview" />
            <SubmitButton pendingLabel="Saving...">Interview {firstName}</SubmitButton>
          </ActionForm>
          <button type="button" className="btn-secondary" onClick={() => setDeclining(true)}>Not for us</button>
        </div>
      ) : (
        <ActionForm action={decideShortlistItem} className="client-decline">
          <input type="hidden" name="token" value={token!} />
          <input type="hidden" name="itemId" value={itemId} />
          <input type="hidden" name="decision" value="declined" />
          <fieldset>
            <legend>Mainly because of</legend>
            <div className="client-reasons">
              {DECISION_REASONS.map((reason: string) => (
                <label key={reason} className="client-reason">
                  <input type="radio" name="reason" value={reason} />
                  <span>{DECISION_REASON_LABELS[reason as keyof typeof DECISION_REASON_LABELS]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={`${id}-note`} className="field-label">Anything else the recruiter should know (optional)</label>
            <textarea id={`${id}-note`} name="note" rows={2} maxLength={DECISION_NOTE_LIMIT} className="field-input" />
          </div>
          <div className="client-decision-actions">
            <SubmitButton pendingLabel="Saving...">Send</SubmitButton>
            <button type="button" className="btn-quiet" onClick={() => setDeclining(false)}>Back</button>
          </div>
        </ActionForm>
      )}
    </div>
  );
}
