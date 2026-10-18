import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFeature } from "@/lib/feature-access";
import { getSettings } from "@/lib/settings";
import { loadArrangement } from "@/lib/arrange";
import { interviewLink } from "@/lib/interviews";
import { formatWhen } from "@/lib/dates";
import { factDate } from "@/lib/fact-labels";
import { ARRANGE_DURATIONS, ARRANGE_ZONES, MAX_OFFER_TIMES, arrangeMessage, tomorrowIn, whenText } from "@/lib/arrange-core.mjs";
import { offerInterviewTimes, setInterviewTime, withdrawInterviewOffer } from "@/app/actions/arrange-interview";
import { cancelBooking } from "@/app/actions/booking";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { ClientEmailComposer } from "@/components/ClientEmailComposer";

export const dynamic = "force-dynamic";

// Arranging one candidate's client interview, in one place. The client asked
// to meet them (on the role's link or a custom shortlist); the recruiter
// either sets the time they agreed with both sides, or offers the candidate a
// few times to pick from. Whatever is missing on the way - the role's client
// link, the client's answer on it - is done by the same click. Reading this
// page writes nothing. After either, the message to the candidate is ready to
// copy, with LinkedIn opened; Capture sends nothing.

function Fields({ prefix, zone, duration, location }: { prefix: string; zone: string; duration: number; location: string }) {
  const zones = Array.from(new Set([zone, ...ARRANGE_ZONES]));
  return (
    <div className="arrange-fields">
      <div>
        <label htmlFor={`${prefix}-zone`} className="field-label">Time zone</label>
        <select id={`${prefix}-zone`} name="timeZone" defaultValue={zone} className="field-input">
          {zones.map((value) => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${prefix}-length`} className="field-label">Length</label>
        <select id={`${prefix}-length`} name="durationMins" defaultValue={String(duration)} className="field-input">
          {ARRANGE_DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
        </select>
      </div>
      <div className="arrange-fields-wide">
        <label htmlFor={`${prefix}-where`} className="field-label">Where (optional)</label>
        <input id={`${prefix}-where`} name="location" defaultValue={location} maxLength={300} className="field-input" placeholder="https://meet.example.com/… or an address" />
      </div>
    </div>
  );
}

export default async function ArrangeInterviewPage({ params }: { params: { id: string } }) {
  const { owner, readOnly } = await requireFeature("clientShortlists");
  const settings = await getSettings();
  const now = new Date();
  const arrangement = await loadArrangement(params.id, owner.id, now);
  if (!arrangement) notFound();
  const { candidate, asked, consentAt, offer, booking, blocked, roleItem } = arrangement;
  const client = candidate.role.client || "the client";
  const firstName = candidate.fullName.trim().split(/\s+/)[0];
  const recruiterName = settings.recruiterName || owner.name;
  const zone = candidate.role.interviewTimezone ?? settings.bookingTimezone;
  const duration = candidate.role.interviewDurationMins && ARRANGE_DURATIONS.includes(candidate.role.interviewDurationMins) ? candidate.role.interviewDurationMins : 45;
  const location = candidate.role.interviewLocation ?? settings.meetingLink ?? "";
  const day = tomorrowIn(zone, now);
  const link = interviewLink(candidate.id, now) ?? "";
  const lastSent = candidate.outreach[0] ? formatWhen(candidate.outreach[0].sentAt) : null;
  const backHref = `/roles/${candidate.role.id}#candidate-${candidate.id}`;
  const openOffer = offer && offer.open.length ? offer : null;

  const message = (kind: "booked" | "offered", when?: string) => (
    <ClientEmailComposer
      key={`${kind}-${booking?.id ?? openOffer?.offer.id ?? ""}`}
      idPrefix="candidate-email"
      recipientLabel={`${firstName}’s email address`}
      initialRecipient={candidate.person?.email ?? ""}
      initialSubject={kind === "booked" ? `Your interview with ${client}: ${candidate.role.title}` : `Interview with ${client}: please choose a time`}
      initialBody={arrangeMessage({ kind, firstName, client, roleTitle: candidate.role.title, when, link, recruiterName })}
      rows={12}
      disabled={readOnly}
      recordFor={{ candidateId: candidate.id, lastSent }}
    />
  );

  return (
    <fieldset disabled={readOnly} className="min-w-0 max-w-4xl space-y-8">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">{candidate.role.title} · {client}</p>
          <h1>Arrange {firstName}&rsquo;s interview</h1>
          <p className="page-description">
            {asked
              ? <>{client} asked to meet {candidate.fullName}{asked.at ? <> on {factDate.format(asked.at)}</> : null}{asked.on ? <>, on the shortlist &ldquo;{asked.on}&rdquo;</> : null}.</>
              : <>{client} has not said they want to meet {candidate.fullName} yet. You can still arrange it if they told you another way.</>}
          </p>
        </div>
        <Link href={backHref} className="btn-quiet">Back to the role</Link>
      </header>

      {blocked ? (
        <p role="alert" className="arrange-blocked">{blocked}</p>
      ) : booking ? (
        <section aria-labelledby="booked-heading" className="arrange-card space-y-4">
          <h2 id="booked-heading" className="arrange-card-title">Interview booked</h2>
          <dl className="arrange-facts">
            <div><dt>When</dt><dd>{whenText(booking.startsAt.getTime(), booking.timeZone ?? zone)}</dd></div>
            <div><dt>Length</dt><dd>{Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000)} minutes</dd></div>
            <div><dt>Where</dt><dd>{booking.meetingUrl ?? booking.place ?? candidate.role.interviewLocation ?? "To be confirmed"}</dd></div>
          </dl>
          <p className="text-sm text-ink-soft">{client} sees it on their page, with a calendar file. Let {firstName} know by email:</p>
          {message("booked", whenText(booking.startsAt.getTime(), booking.timeZone ?? zone))}
          <form action={cancelBooking}>
            <input type="hidden" name="bookingId" value={booking.id} />
            <ConfirmSubmitButton label="Cancel the interview" className="btn-quiet btn-danger-quiet" confirmText={`Cancel ${firstName}'s interview with ${client}? The time is freed and ${client}'s page stops showing it.`} />
          </form>
        </section>
      ) : openOffer ? (
        <section aria-labelledby="offered-heading" className="arrange-card space-y-4">
          <h2 id="offered-heading" className="arrange-card-title">Waiting for {firstName} to choose</h2>
          <ul className="arrange-times" aria-label="Times offered">
            {openOffer.open.map((at) => <li key={at}>{whenText(at, openOffer.offer.timeZone)}</li>)}
          </ul>
          <p className="text-sm text-ink-soft">
            {openOffer.offer.durationMins} minutes{openOffer.offer.location ? `, ${openOffer.offer.location}` : ""}. Email {firstName}; the link in it shows these times, and the one they pick is booked straight away and appears on {client}&rsquo;s page.
          </p>
          {message("offered")}
          <div className="flex flex-wrap items-center gap-2">
            <form action={withdrawInterviewOffer}>
              <input type="hidden" name="candidateId" value={candidate.id} />
              <ConfirmSubmitButton label="Withdraw these times" confirmText={`Withdraw these times? ${firstName}'s link stops offering them.`} />
            </form>
          </div>
        </section>
      ) : (
        <>
          <div className="arrange-choices">
            <section aria-labelledby="set-heading" className="arrange-card">
              <h2 id="set-heading" className="arrange-card-title">You agreed a time</h2>
              <p className="arrange-card-lede">Settled with {client} and {firstName} already? Enter it and it is booked.</p>
              <ActionForm action={setInterviewTime} className="space-y-4">
                <input type="hidden" name="candidateId" value={candidate.id} />
                <div className="arrange-when">
                  <div>
                    <label htmlFor="set-date" className="field-label">Date</label>
                    <input id="set-date" name="date" type="date" defaultValue={day} required className="field-input" />
                  </div>
                  <div>
                    <label htmlFor="set-time" className="field-label">Time</label>
                    <input id="set-time" name="time" type="time" defaultValue="10:00" step={300} required className="field-input" />
                  </div>
                </div>
                <Fields prefix="set" zone={zone} duration={duration} location={location} />
                {!consentAt && <ConsentTick id="set-agreed" name={candidate.fullName} client={client} />}
                <SubmitButton pendingLabel="Booking…">Book the interview</SubmitButton>
              </ActionForm>
            </section>
            <section aria-labelledby="offer-heading" className="arrange-card">
              <h2 id="offer-heading" className="arrange-card-title">Offer a few times</h2>
              <p className="arrange-card-lede">Put two or three times {client} can do; {firstName} picks one from a link.</p>
              <ActionForm action={offerInterviewTimes} className="space-y-4">
                <input type="hidden" name="candidateId" value={candidate.id} />
                <ol className="arrange-offer-rows">
                  {Array.from({ length: MAX_OFFER_TIMES }, (_, index) => (
                    <li key={index} className="arrange-when">
                      <div>
                        <label htmlFor={`offer-date-${index}`} className="field-label">Option {index + 1}{index === 0 ? "" : " (optional)"}</label>
                        <input id={`offer-date-${index}`} name={`date-${index}`} type="date" required={index === 0} defaultValue={index === 0 ? day : undefined} className="field-input" aria-label={`Date ${index + 1}`} />
                      </div>
                      <div>
                        <span className="field-label" aria-hidden="true">&nbsp;</span>
                        <input name={`time-${index}`} type="time" step={300} required={index === 0} defaultValue={index === 0 ? "10:00" : undefined} className="field-input" aria-label={`Time ${index + 1}`} />
                      </div>
                    </li>
                  ))}
                </ol>
                <Fields prefix="offer" zone={zone} duration={duration} location={location} />
                {!consentAt && <ConsentTick id="offer-agreed" name={candidate.fullName} client={client} />}
                <SubmitButton pendingLabel="Saving…" className="btn-secondary">Offer these times</SubmitButton>
              </ActionForm>
            </section>
          </div>
          {!roleItem && <p className="text-sm text-ink-soft">Either one also puts {firstName} on this role&rsquo;s client link, so {client} sees the interview on their page.</p>}
        </>
      )}
    </fieldset>
  );
}

function ConsentTick({ id, name, client }: { id: string; name: string; client: string }) {
  return (
    <label htmlFor={id} className="arrange-consent">
      <input id={id} type="checkbox" name="agreed" required />
      <span>{name} agreed to be put forward to {client}.</span>
    </label>
  );
}
