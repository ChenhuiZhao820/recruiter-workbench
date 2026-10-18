import type { Metadata } from "next";
import { bookingReadiness, candidateCanBook, freeSlots, loadBookingContext, privacyNoticeText } from "@/lib/booking";
import { LocalTime, SlotPicker } from "@/components/SlotPicker";
import { interviewPlace, interviewSlots } from "@/lib/interviews";
import { interviewLinkState } from "@/lib/shortlist-core.mjs";

export const dynamic = "force-dynamic";

// A candidate's page, reached from the link in a recruiter's message. No
// session: the signed link is the only key, and it opens this one person's
// booking and nothing else. A call with the recruiter shows the recruiter's
// name and the role, never the client. A client interview link names the
// client, because the candidate agreed to be put forward to them. Neither is
// for search engines.
export const metadata: Metadata = {
  title: "Book a call",
  robots: { index: false, follow: false },
  // same-origin, not no-referrer: under no-referrer Chrome posts the form with
  // `Origin: null`, which Next cannot parse. Other sites still get no referrer.
  referrer: "same-origin",
};

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="booking-page">{children}</div>;
}

export default async function BookingPage({ params }: { params: { token: string } }) {
  const now = new Date();
  const context = await loadBookingContext(params.token, now);
  if (!context) {
    return (
      <Shell>
        <h1>This link has expired</h1>
        <p className="page-description">Booking links last 30 days. Reply to the message that sent it and you will get a new one.</p>
      </Shell>
    );
  }
  const { candidate, owner, settings, booking } = context;
  const who = settings.recruiterName || owner.name;
  const firstName = candidate.fullName.trim().split(/\s+/)[0];

  if (context.read.kind === "interview") {
    const client = candidate.role.client || "the client";
    const place = interviewPlace(candidate.role.interviewLocation);
    if (booking) {
      return (
        <Shell>
          <h1>Your interview is booked, {firstName}</h1>
          <div className="booking-confirmed">
            <dl>
              <div><dt>When</dt><dd><LocalTime at={booking.startsAt.getTime()} recruiterZone={candidate.role.interviewTimezone ?? settings.bookingTimezone} /></dd></div>
              <div><dt>With</dt><dd>{client}, about the {candidate.role.title} role</dd></div>
              <div>
                <dt>Where</dt>
                <dd>
                  {booking.meetingUrl
                    ? <>Video call: <a href={booking.meetingUrl} className="underline underline-offset-2" rel="noopener noreferrer">{booking.meetingUrl}</a></>
                    : place.text ?? <>{who} will send you the details.</>}
                </dd>
              </div>
            </dl>
            <a href={`/book/${params.token}/ics`} className="btn-secondary" download>Add to your calendar (.ics)</a>
          </div>
          <p className="section-caption">To change the time, reply to {who}.</p>
        </Shell>
      );
    }
    const state = interviewLinkState({ role: candidate.role, candidate: { ...candidate, roleId: candidate.role.id }, person: candidate.person, item: candidate.shortlistItems[0] ?? null });
    if (!state.ok) {
      return (
        <Shell>
          <h1>This link is no longer active</h1>
          <p className="page-description">Reply to {who} to arrange a time.</p>
        </Shell>
      );
    }
    const slots = await interviewSlots(owner.id, candidate.role, now);
    return (
      <Shell>
        <h1>Book your interview with {client}</h1>
        <p className="page-description">
          Hi {firstName}, {client} would like to meet you about the {candidate.role.title} role.
          Choose a time that suits you; you will see it confirmed straight away.
          {place.url ? " It is a video call." : place.text ? ` It is at ${place.text}.` : ""}
        </p>
        <SlotPicker
          token={params.token}
          slots={slots}
          durationMins={candidate.role.interviewDurationMins!}
          offerVideo={false}
          offerPhone={false}
          recruiterZone={candidate.role.interviewTimezone!}
          notice={privacyNoticeText(settings, owner.email)}
          variant="interview"
        />
      </Shell>
    );
  }

  if (booking) {
    return (
      <Shell>
        <p className="page-eyebrow">Call booked</p>
        <h1>You are booked in, {firstName}</h1>
        <div className="booking-confirmed">
          <dl>
            <div><dt>When</dt><dd><LocalTime at={booking.startsAt.getTime()} recruiterZone={settings.bookingTimezone} /></dd></div>
            <div><dt>With</dt><dd>{who}, about the {candidate.role.title} role</dd></div>
            <div>
              <dt>How</dt>
              <dd>
                {booking.mode === "video" && booking.meetingUrl
                  ? <>Video call: <a href={booking.meetingUrl} className="underline underline-offset-2" rel="noopener noreferrer">{booking.meetingUrl}</a></>
                  : <>{who} will call you on {booking.phone}</>}
              </dd>
            </div>
          </dl>
          <a href={`/book/${params.token}/ics`} className="btn-secondary" download>Add to your calendar (.ics)</a>
        </div>
        <p className="section-caption">To change the time, reply to the message that sent you this link.</p>
      </Shell>
    );
  }

  if (!bookingReadiness(settings).ready || !candidateCanBook(candidate)) {
    return (
      <Shell>
        <h1>This link is no longer active</h1>
        <p className="page-description">Reply to {who} to arrange a time.</p>
      </Shell>
    );
  }

  const slots = await freeSlots(owner.id, settings, now);
  return (
    <Shell>
      <p className="page-eyebrow">{candidate.role.title}</p>
      <h1>Book a call with {who}</h1>
      <p className="page-description">Hi {firstName}, choose a time that suits you. You will see it confirmed straight away.</p>
      <SlotPicker
        token={params.token}
        slots={slots}
        durationMins={settings.bookingDurationMins}
        offerVideo={Boolean(settings.meetingLink)}
        offerPhone={settings.offerPhone}
        recruiterZone={settings.bookingTimezone}
        notice={privacyNoticeText(settings, owner.email)}
      />
    </Shell>
  );
}
