import Link from "next/link";
import { requireFeature } from "@/lib/feature-access";
import { getSettings } from "@/lib/settings";
import { updateBookingSettings } from "@/app/actions/booking";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { bookingReadiness, defaultPrivacyNotice } from "@/lib/booking";
import { DURATIONS, WEEKDAYS, WEEKDAY_NAMES, minutesToTime, parseWindows } from "@/lib/booking-core.mjs";

export const dynamic = "force-dynamic";

// The time zones a recruiter in the UK is most likely to work in come first;
// the full list follows for everyone else.
const COMMON_ZONES = ["Europe/London", "Europe/Dublin", "Europe/Paris", "Europe/Berlin", "America/New_York", "Asia/Dubai", "Asia/Singapore"];

function allZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return COMMON_ZONES;
  }
}

export default async function BookingSettingsPage() {
  const { owner, readOnly } = await requireFeature("booking");
  const settings = await getSettings();
  const windows = parseWindows(settings.bookingWindows);
  const byDay = new Map(windows.map((window) => [window.day, window]));
  const readiness = bookingReadiness(settings);
  const zones = Array.from(new Set([...COMMON_ZONES, ...allZones(), settings.bookingTimezone]));

  return (
    <fieldset key={owner.id} disabled={readOnly} className="min-w-0 max-w-3xl">
      <header className="page-header">
        <div>
          <p className="page-eyebrow"><Link href="/settings" className="hover:text-ink">Settings</Link> / Booking page</p>
          <h1>Booking page</h1>
          <p className="page-description">
            Candidates pick a time for a call from a link in your message. Put {"{{booking_link}}"} in a template and each person gets their own.
          </p>
        </div>
      </header>

      <p role="status" className={readiness.ready ? "auth-success mb-6" : "booking-setup-note mb-6"}>
        {readiness.ready
          ? "Booking links are working. Each one lasts 30 days and stops if the role closes, the candidate is rejected or placed, or they ask not to be contacted."
          : `Booking links start working once you add ${readiness.missing.join(" and ")}.`}
      </p>

      <ActionForm action={updateBookingSettings} className="space-y-10">
        <section aria-labelledby="hours-heading" className="space-y-4">
          <div>
            <h2 id="hours-heading" className="section-heading">When you take calls</h2>
            <p className="section-caption">Your own hours, in your time zone. Candidates see them in theirs.</p>
          </div>
          <div className="booking-week">
            {WEEKDAYS.map((day) => {
              const window = byDay.get(day);
              const name = WEEKDAY_NAMES[day];
              return (
                <div key={day} className="booking-day">
                  <label className="booking-day-name">
                    <input type="checkbox" name={`day-${day}`} defaultChecked={Boolean(window)} className="screening-check" />
                    {name}
                  </label>
                  <div className="booking-day-times">
                    <label htmlFor={`start-${day}`} className="sr-only">{name} from</label>
                    <input id={`start-${day}`} name={`start-${day}`} type="time" step={900} defaultValue={minutesToTime(window?.startMin ?? 9 * 60 + 30)} className="field-input tabular" />
                    <span aria-hidden="true" className="text-ink-soft">to</span>
                    <label htmlFor={`end-${day}`} className="sr-only">{name} until</label>
                    <input id={`end-${day}`} name={`end-${day}`} type="time" step={900} defaultValue={minutesToTime(window?.endMin ?? 17 * 60)} className="field-input tabular" />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="booking-grid">
            <div>
              <label htmlFor="bookingTimezone" className="field-label">Your time zone</label>
              <select id="bookingTimezone" name="bookingTimezone" defaultValue={settings.bookingTimezone} className="field-input">
                {zones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="bookingDurationMins" className="field-label">Call length</label>
              <select id="bookingDurationMins" name="bookingDurationMins" defaultValue={String(settings.bookingDurationMins)} className="field-input">
                {DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="bookingMinNoticeHours" className="field-label">Minimum notice (hours)</label>
              <input id="bookingMinNoticeHours" name="bookingMinNoticeHours" type="number" min={0} max={336} defaultValue={settings.bookingMinNoticeHours} className="field-input tabular" />
            </div>
            <div>
              <label htmlFor="bookingHorizonDays" className="field-label">Bookable up to (days ahead)</label>
              <input id="bookingHorizonDays" name="bookingHorizonDays" type="number" min={1} max={90} defaultValue={settings.bookingHorizonDays} className="field-input tabular" />
            </div>
          </div>
        </section>

        <section aria-labelledby="how-heading" className="space-y-4">
          <div>
            <h2 id="how-heading" className="section-heading">How the call happens</h2>
            <p className="section-caption">Offer a video link, a phone call, or both; the candidate chooses.</p>
          </div>
          <div>
            <label htmlFor="meetingLink" className="field-label">Meeting link</label>
            <input id="meetingLink" name="meetingLink" type="url" defaultValue={settings.meetingLink} placeholder="https://meet.google.com/abc-defg-hij" className="field-input" aria-describedby="meetingLink-help" />
            <p id="meetingLink-help" className="mt-2 text-xs text-ink-soft">Your personal Zoom, Teams or Meet room. The same link is given for every call.</p>
          </div>
          <label className="screening-consent">
            <input type="checkbox" name="offerPhone" defaultChecked={settings.offerPhone} className="screening-check" />
            <span>
              Offer a phone call
              <span className="block text-xs text-ink-soft">The candidate gives a number, and you call them at the time they picked.</span>
            </span>
          </label>
        </section>

        <section aria-labelledby="privacy-heading" className="space-y-4">
          <div>
            <h2 id="privacy-heading" className="section-heading">Privacy notice</h2>
            <p className="section-caption">Shown in full on the booking page. Leave it empty to use the standard text below.</p>
          </div>
          <div>
            <label htmlFor="privacyContactEmail" className="field-label">Where people ask about their data</label>
            <input id="privacyContactEmail" name="privacyContactEmail" type="email" defaultValue={settings.privacyContactEmail} placeholder={owner.email} className="field-input" aria-describedby="privacyContactEmail-help" />
            <p id="privacyContactEmail-help" className="mt-2 text-xs text-ink-soft">Empty means your account email, {owner.email}.</p>
          </div>
          <div>
            <label htmlFor="privacyNotice" className="field-label">Your own notice (optional)</label>
            <textarea id="privacyNotice" name="privacyNotice" rows={8} defaultValue={settings.privacyNotice} className="field-input" placeholder={defaultPrivacyNotice(settings.recruiterName, settings.privacyContactEmail || owner.email)} />
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
          <SubmitButton pendingLabel="Saving...">Save booking page</SubmitButton>
          <Link href="/settings" className="btn-quiet">Back to settings</Link>
        </div>
      </ActionForm>
    </fieldset>
  );
}
