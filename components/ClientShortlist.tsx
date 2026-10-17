import type { ClientShortlistView } from "@/lib/shortlists";
import { ClientDecision } from "@/components/ClientDecision";

// The page a client reads: the people a recruiter has put forward, as
// ClientProfile allows and nothing more. Shared by /s/<token> and the
// recruiter's preview, so the preview cannot drift from what the client sees.
// The token is null in the preview, where the answers are shown but inert.

const addedOn = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function count(n: number) {
  return `${n} ${n === 1 ? "candidate" : "candidates"}`;
}

export function ClientShortlist({ view, token }: { view: ClientShortlistView; token: string | null }) {
  const heading = view.roleTitle ?? view.title;
  return (
    <article className="client-page" aria-labelledby="client-heading">
      <header className="client-header">
        <h1 id="client-heading">{heading}</h1>
        <p className="client-meta">
          Put forward by <strong>{view.recruiterName}</strong>
          {view.client ? <> for <strong>{view.client}</strong></> : null}
          <span aria-hidden="true"> · </span>
          <span className="tabular">{count(view.entries.length)}</span>
        </p>
        <p className="client-note">
          Each person agreed to be put forward. What they told {view.recruiterName} about pay, notice,
          location and right to work is in their own words and has not been checked.
        </p>
      </header>

      {view.entries.length === 0 ? (
        <div className="client-empty">
          <h2>No one here yet</h2>
          <p>{view.recruiterName} has not put anyone forward on this page yet. It fills in as they do, at the same address.</p>
        </div>
      ) : (
        <ol className="client-list">
          {view.entries.map(({ itemId, profile, addedAt, decision, canDecide }) => (
            <li key={itemId} id={`entry-${itemId}`} className="client-entry">
              <div className="client-entry-head">
                <div className="min-w-0">
                  <h2 className="client-name">{profile.fullName}</h2>
                  {profile.headline && <p className="client-headline">{profile.headline}</p>}
                </div>
                <p className="client-added">Added <time dateTime={addedAt.toISOString()}>{addedOn.format(addedAt)}</time></p>
              </div>

              {profile.pitch && <p className="client-pitch">{profile.pitch}</p>}

              {profile.facts.length > 0 ? (
                <dl className="client-facts">
                  {profile.facts.map((fact) => (
                    <div key={fact.field}>
                      <dt>{fact.label}</dt>
                      <dd>
                        <span>{fact.value}</span>
                        {fact.note && <span className="client-fact-note">{fact.note}</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="client-facts-none">Pay, notice, location and right to work are still to be confirmed.</p>
              )}

              {(profile.skills || profile.motivation) && (
                <dl className="client-story">
                  {profile.skills && <div><dt>Skills</dt><dd>{profile.skills}</dd></div>}
                  {profile.motivation && <div><dt>Why they would move</dt><dd>{profile.motivation}</dd></div>}
                </dl>
              )}

              {profile.factsConfirmedOn && (
                <p className="client-confirmed">
                  Confirmed with them on {profile.factsConfirmedOn}
                  {profile.factsMayBeOutOfDate && <span className="chip person-stale">May be out of date</span>}
                </p>
              )}

              {/* Keyed by the answer, so a saved change starts the control afresh. */}
              <ClientDecision key={`${itemId}-${decision?.decision ?? "none"}-${decision?.at.toISOString() ?? ""}`} token={token} itemId={itemId} firstName={profile.fullName.trim().split(/\s+/)[0] || profile.fullName} decision={decision} canDecide={canDecide} />
            </li>
          ))}
        </ol>
      )}

      <footer className="client-footer">
        <p>Your answers go straight to {view.recruiterName}. To ask about anyone here, reply to them.</p>
        <p>This page is private to you. Please do not forward it.</p>
      </footer>
    </article>
  );
}

export function ClientLinkInactive({ recruiterName }: { recruiterName: string | null }) {
  return (
    <article className="client-page">
      <header className="client-header">
        <h1>This link is no longer active</h1>
        <p className="client-note">
          {recruiterName ? `Ask ${recruiterName} for an up-to-date link.` : "Ask the recruiter who sent it for an up-to-date link."}
        </p>
      </header>
    </article>
  );
}
