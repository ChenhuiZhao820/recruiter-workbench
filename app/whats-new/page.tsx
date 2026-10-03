import Link from "next/link";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { featureAvailability } from "@/lib/feature-access";
import { dismissRelease } from "@/app/actions/release";
import { bookingReadiness } from "@/lib/booking";

export const dynamic = "force-dynamic";

// One release, written as the habits it changes. Nobody wants release notes;
// they want to know which of the things they do every day is different now,
// and what they have to do once before it works. What a plan does not include
// is left out, not teased.
export default async function WhatsNewPage() {
  const { owner, readOnly } = await getWorkspace();
  const features = await featureAvailability();
  const [settings, people] = await Promise.all([
    db.settings.findUnique({ where: { userId: owner.id }, select: { bookingWindows: true, meetingLink: true, offerPhone: true } }),
    db.person.count({ where: { userId: owner.id } }),
  ]);
  const bookingReady = settings ? bookingReadiness(settings).ready : false;

  return (
    <fieldset disabled={readOnly} className="min-w-0 max-w-3xl">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Capture / 3 October</p>
          <h1>What&rsquo;s new</h1>
          <p className="page-description">Everyone you talk to now becomes a record you keep, and the steps between a first message and a client email got shorter.</p>
        </div>
      </header>

      <ol className="space-y-4">
        <li className="card space-y-2">
          <h2 className="text-lg">Everyone is one person now, across every role</h2>
          <p className="text-ink/80">
            Save the same profile for a second role and it is the same person, with every role, message and call in one place
            under <strong>People</strong> in the sidebar. Two people who share a name stay two people.
          </p>
          <p className="text-ink/80">
            From a person&rsquo;s page you can mark them do not contact, or erase them completely; Capture then warns you if the same
            profile is saved again. Settings has a full download of your data, and People lists anyone with no activity for a year,
            to keep or erase.
          </p>
          <p>
            <Link href="/people" className="btn-quiet">
              {people > 0 ? `Open People (${people})` : "Open People"}
            </Link>
          </p>
        </li>

        <li className="card space-y-2">
          <h2 className="text-lg">Candidates book their own call</h2>
          <p className="text-ink/80">
            Put <code className="font-mono">{"{{booking_link}}"}</code> in a template and each person gets their own link to a page with your free
            times, in their time zone. They pick one, and it lands on the role page and in Follow-ups with a calendar file; they move to Booked.
            Capture sends nothing; the link travels in your own message.
          </p>
          {!bookingReady && (
            <p className="rounded border border-line bg-sunken p-3 text-sm">
              <strong>One thing to do once.</strong> Choose the hours you take calls and how the call happens, and the links start working.
            </p>
          )}
          <p>
            <Link href="/settings/booking" className="btn-quiet">
              {bookingReady ? "Booking page settings" : "Set up your booking page"}
            </Link>
          </p>
        </li>

        {features.screening && (
          <li className="card space-y-2">
            <h2 className="text-lg">A screening call becomes four facts, and an email to the client</h2>
            <p className="text-ink/80">
              Paste the transcript your call app saved, or your notes, and press <em>Summarise</em>. Salary, notice, location and right to
              work come back next to the line the candidate said them in; anything the summary cannot quote is marked for you to check.
              Nothing is saved to their record until you confirm all four.
            </p>
            {features.clientEmail && (
              <p className="text-ink/80">
                Once they agree to be put forward, the facts become an email to the client that you edit and send from your own inbox.
                Marking it sent moves them to Submitted.
              </p>
            )}
            <p className="text-sm text-ink-soft">Find it under <em>Screening</em> on any candidate.</p>
          </li>
        )}

        {(features.talentMatches || features.peopleSearch || features.revisitReminders) && (
          <li className="card space-y-2">
            <h2 className="text-lg">Your own database finds people for a new role</h2>
            {features.talentMatches && (
              <p className="text-ink/80">
                Each role now lists <em>From your database</em> at the end of its candidates: people you already know who fit its key skills,
                leaving out anyone above the budget you can now set on the role.
              </p>
            )}
            {features.peopleSearch && (
              <p className="text-ink/80">
                People search reaches what they told you, and filters by salary, notice, working pattern and right to work.
              </p>
            )}
            {features.revisitReminders && (
              <p className="text-ink/80">
                &ldquo;Get back to me in six months&rdquo; becomes a reminder that shows in Follow-ups the week it is due.
              </p>
            )}
          </li>
        )}
      </ol>

      <p className="mt-6 text-sm text-ink-soft">
        No new copy of the browser extension is needed this time.
      </p>
      {!readOnly && (
        <form action={dismissRelease} className="mt-6">
          <button type="submit" className="btn-primary">
            Got it
          </button>
        </form>
      )}
      <p className="mt-3 text-sm text-ink-soft">
        This page stays put until you press Got it, and the link in the top bar disappears with it.
      </p>
    </fieldset>
  );
}
