"use client";

import { useEffect, useState } from "react";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { setHoursFromClient } from "@/app/actions/interviews";

// Asked on the client's own page when they want to meet someone and the role
// has no interview hours yet: when they interview, already ticked Monday to
// Friday, nine to five, in their own time zone. Saved once; after that the
// hours are the recruiter's to change.

const DAYS = [
  { day: 1, name: "Monday", on: true },
  { day: 2, name: "Tuesday", on: true },
  { day: 3, name: "Wednesday", on: true },
  { day: 4, name: "Thursday", on: true },
  { day: 5, name: "Friday", on: true },
  { day: 6, name: "Saturday", on: false },
  { day: 0, name: "Sunday", on: false },
];

export function ClientHoursPanel({ token, recruiterName }: { token: string; recruiterName: string }) {
  const [zone, setZone] = useState("Europe/London");
  useEffect(() => {
    try {
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (local) setZone(local);
    } catch {
      // Keep the default.
    }
  }, []);

  return (
    <section aria-labelledby="client-hours" className="client-hours">
      <h2 id="client-hours">When could you interview?</h2>
      <p>
        Tick the hours that usually suit you. The people you want to meet then pick a time inside them, and {recruiterName} sees it.
        You only do this once; {recruiterName} can change it later.
      </p>
      <ActionForm action={setHoursFromClient} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="timeZone" value={zone} />
        <div className="booking-week">
          {DAYS.map(({ day, name, on }) => (
            <div key={day} className="booking-day">
              <label className="booking-day-name">
                <input type="checkbox" name={`day-${day}`} defaultChecked={on} className="screening-check" />
                {name}
              </label>
              <div className="booking-day-times">
                <label htmlFor={`client-start-${day}`} className="sr-only">{name} from</label>
                <input id={`client-start-${day}`} name={`start-${day}`} type="time" step={900} defaultValue="09:00" className="field-input tabular" />
                <span aria-hidden="true" className="text-ink-soft">to</span>
                <label htmlFor={`client-end-${day}`} className="sr-only">{name} until</label>
                <input id={`client-end-${day}`} name={`end-${day}`} type="time" step={900} defaultValue="17:00" className="field-input tabular" />
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="client-length" className="field-label">An interview lasts</label>
            <select id="client-length" name="durationMins" defaultValue="45" className="field-input">
              {[30, 45, 60, 90].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
            </select>
          </div>
          <p className="pb-2 text-sm text-ink-soft">Times are in {zone.replace(/_/g, " ")}.</p>
        </div>
        <SubmitButton pendingLabel="Saving...">Save these hours</SubmitButton>
      </ActionForm>
    </section>
  );
}
