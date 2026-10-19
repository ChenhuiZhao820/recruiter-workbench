import type { ClientShortlistView } from "@/lib/shortlists";
import { ClientDecision } from "@/components/ClientDecision";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { openNamedLink } from "@/app/actions/shortlist-access";
import { clientCannotMakeIt } from "@/app/actions/interviews";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { LocalTime } from "@/components/SlotPicker";
import { googleCalendarUrl } from "@/lib/booking-core.mjs";

// The page a client reads: the people a recruiter has put forward, as
// ClientProfile allows and nothing more. Shared by /s/<token> and the
// recruiter's preview, so the preview cannot drift from what the client sees.
// The token is null in the preview, where the answers are shown but inert.

const addedOn = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function count(n: number) {
  return `${n} ${n === 1 ? "candidate" : "candidates"}`;
}

// Where a CV is read from: behind the client's own link, or, in the in-app
// preview, behind the recruiter's session. `v` is the upload, so a CV
// replaced while the link is open is never served from an old copy.
function cvHref(token: string | null, previewOf: string | null, itemId: string, version: number) {
  if (token) return `/s/${token}/cv/${itemId}?v=${version}`;
  if (previewOf) return `/shortlists/${previewOf}/preview/cv/${itemId}?v=${version}`;
  return null;
}

export function ClientShortlist({ view, token, previewOf = null }: { view: ClientShortlistView; token: string | null; previewOf?: string | null }) {
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
          {!view.reviewFirst && <> Everyone here is invited to book an interview with you at a time inside your interview hours.</>}
        </p>
      </header>


      {view.interviews.length > 0 && (
        <section aria-labelledby="client-interviews" className="client-interviews">
          <h2 id="client-interviews">Interviews</h2>
          <ul>
            {view.interviews.map((interview) => (
              <li key={interview.bookingId}>
                <div className="min-w-0">
                  <p className="client-interview-who">{interview.fullName}</p>
                  <p className="client-interview-when"><LocalTime at={interview.startsAt.getTime()} recruiterZone={interview.timeZone} /></p>
                  <p className="client-interview-where">
                    {interview.meetingUrl
                      ? <>Video call: <a href={interview.meetingUrl} rel="noopener noreferrer" className="underline underline-offset-2">{interview.meetingUrl}</a></>
                      : interview.place ?? `${view.recruiterName} will send the details.`}
                  </p>
                </div>
                {token && (
                  <div className="client-interview-actions">
                    <a
                      href={googleCalendarUrl({
                        start: interview.startsAt.getTime(),
                        end: interview.endsAt.getTime(),
                        title: `Interview: ${interview.fullName} (${interview.roleTitle})`,
                        details: interview.meetingUrl ?? interview.place ?? "",
                        location: interview.meetingUrl ?? interview.place ?? undefined,
                      })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-quiet"
                    >
                      Add to Google Calendar
                    </a>
                    <a href={`/s/${token}/interviews/${interview.bookingId}`} className="btn-quiet" download>Calendar file</a>
                    <ActionForm action={clientCannotMakeIt} className="contents">
                      <input type="hidden" name="token" value={token} />
                      <input type="hidden" name="bookingId" value={interview.bookingId} />
                      <ConfirmSubmitButton
                        label="Can't make this time"
                        confirmText={`Cancel the interview with ${interview.fullName}? The time is freed and ${view.recruiterName} will find a new one with them.`}
                      />
                    </ActionForm>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.entries.length === 0 ? (
        <div className="client-empty">
          <h2>No one here yet</h2>
          <p>{view.recruiterName} has not put anyone forward on this page yet. It fills in as they do, at the same address.</p>
        </div>
      ) : (
        <ol className="client-list">
          {view.entries.map(({ itemId, profile, addedAt, decision, canDecide, cv }) => (
            <li key={itemId} id={`entry-${itemId}`} className="client-entry">
              <div className="client-entry-head">
                <div className="min-w-0">
                  <h2 className="client-name">{profile.fullName}</h2>
                  {profile.headline && <p className="client-headline">{profile.headline}</p>}
                </div>
                <p className="client-added">Added <time dateTime={addedAt.toISOString()}>{addedOn.format(addedAt)}</time></p>
              </div>

              {profile.pitch && <p className="client-pitch">{profile.pitch}</p>}

              {/* With a CV the client reads it, as they asked to; without one, the
                  confirmed facts as before. Never the LinkedIn profile. */}
              {cv && cvHref(token, previewOf, itemId, cv.version) ? (
                <div className="client-cv">
                  <iframe src={cvHref(token, previewOf, itemId, cv.version)!} title={`${profile.fullName}'s CV`} className="client-cv-frame" loading="lazy" />
                  <p className="client-cv-actions">
                    <a href={cvHref(token, previewOf, itemId, cv.version)!} target="_blank" rel="noopener" className="btn-secondary">Open CV</a>
                    <a href={cvHref(token, previewOf, itemId, cv.version)!} download={cv.fileName} className="btn-quiet">Download</a>
                  </p>
                </div>
              ) : (
                <>
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

                </>
              )}

              {view.reviewFirst ? (
                /* Keyed by the answer, so a saved change starts the control afresh. */
                <ClientDecision key={`${itemId}-${decision?.decision ?? "none"}-${decision?.at.toISOString() ?? ""}`} token={token} itemId={itemId} firstName={profile.fullName.trim().split(/\s+/)[0] || profile.fullName} decision={decision} canDecide={canDecide} />
              ) : (
                <div className="client-decision">
                  <p className={`client-decision-status${canDecide ? "" : " is-yes"}`}>
                    {canDecide
                      ? <>{profile.fullName.trim().split(/\s+/)[0]} is invited to book an interview with you.</>
                      : <>Your interview with {profile.fullName.trim().split(/\s+/)[0]} is booked.</>}
                  </p>
                </div>
              )}
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

// A link sent to one named person: before anything about the candidates is
// shown, the reader types the address it was sent to. Nothing on this screen
// says who the candidates are or which client the page is for.
export function ClientLinkGate({ token, recruiterName }: { token: string; recruiterName: string }) {
  return (
    <article className="client-page">
      <header className="client-header">
        <h1>Confirm it is you</h1>
        <p className="client-note">
          {recruiterName} shared this page with you by email. Enter that email address to open it.
          You only need to do this once on this browser.
        </p>
      </header>
      <ActionForm action={openNamedLink} className="client-gate">
        <input type="hidden" name="token" value={token} />
        <div>
          <label htmlFor="gate-email" className="field-label">Your email address</label>
          <input id="gate-email" name="email" type="email" required autoComplete="email" className="field-input" />
        </div>
        <SubmitButton pendingLabel="Checking...">Open the page</SubmitButton>
      </ActionForm>
    </article>
  );
}
