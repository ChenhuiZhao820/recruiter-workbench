import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { updateInterviewHours } from "@/app/actions/interview-hours";
import { INTERVIEW_DURATIONS, type InterviewHours } from "@/lib/interviews";
import { WEEKDAYS, WEEKDAY_NAMES, minutesToTime, parseWindows } from "@/lib/booking-core.mjs";

// When the client interviews, on the role. It opens already filled in - from
// this role, from the last role for the same client, or from the recruiter's
// own booking hours - so most of the time it only needs a look and a Save.

const ZONES = ["Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin", "Europe/Amsterdam", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney"];

function summary(hours: InterviewHours) {
  const windows = parseWindows(hours.windows);
  const days = WEEKDAYS.filter((day: number) => windows.some((window: { day: number }) => window.day === day)).map((day: number) => WEEKDAY_NAMES[day].slice(0, 3));
  return `${days.join(", ")} · ${hours.durationMins} minutes · ${hours.timeZone.replace(/_/g, " ")}`;
}

export function InterviewHoursForm({ roleId, client, hours, saved }: {
  roleId: string;
  client: string;
  hours: InterviewHours & { from: "role" | "client" | "settings" };
  saved: boolean;
}) {
  const byDay = new Map(parseWindows(hours.windows).map((window: { day: number; startMin: number; endMin: number }) => [window.day, window]));
  const zones = Array.from(new Set([hours.timeZone, ...ZONES]));
  return (
    <details className="interview-hours">
      <summary>
        <span>Interview hours</span>
        <span className="text-xs text-ink-soft">{saved ? summary(hours) : `Not set yet${hours.from === "client" ? ` · ready to copy from another ${client} role` : ""}`}</span>
      </summary>
      <ActionForm action={updateInterviewHours} className="space-y-5">
        <input type="hidden" name="roleId" value={roleId} />
        <p className="section-caption">
          When {client} interviews, in their time zone. Candidates {client} wants to meet pick a time from these, a day ahead at the earliest,
          and two people can never take the same time with {client}, across all of its roles.
          {!saved && hours.from === "client" && <> Filled in from another {client} role.</>}
          {!saved && hours.from === "settings" && <> Filled in from your own booking hours: change them to {client}&rsquo;s.</>}
        </p>
        <div className="booking-week">
          {WEEKDAYS.map((day: number) => {
            const window = byDay.get(day);
            const name = WEEKDAY_NAMES[day];
            return (
              <div key={day} className="booking-day">
                <label className="booking-day-name">
                  <input type="checkbox" name={`iv-day-${day}`} defaultChecked={Boolean(window)} className="screening-check" />
                  {name}
                </label>
                <div className="booking-day-times">
                  <label htmlFor={`iv-start-${roleId}-${day}`} className="sr-only">{name} interviews from</label>
                  <input id={`iv-start-${roleId}-${day}`} name={`iv-start-${day}`} type="time" step={900} defaultValue={minutesToTime(window?.startMin ?? 9 * 60 + 30)} className="field-input tabular" />
                  <span aria-hidden="true" className="text-ink-soft">to</span>
                  <label htmlFor={`iv-end-${roleId}-${day}`} className="sr-only">{name} interviews until</label>
                  <input id={`iv-end-${roleId}-${day}`} name={`iv-end-${day}`} type="time" step={900} defaultValue={minutesToTime(window?.endMin ?? 17 * 60)} className="field-input tabular" />
                </div>
              </div>
            );
          })}
        </div>
        <div className="booking-grid">
          <div>
            <label htmlFor={`iv-zone-${roleId}`} className="field-label">{client}&rsquo;s time zone</label>
            <select id={`iv-zone-${roleId}`} name="interviewTimezone" defaultValue={hours.timeZone} className="field-input">
              {zones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`iv-length-${roleId}`} className="field-label">Interview length</label>
            <select id={`iv-length-${roleId}`} name="interviewDurationMins" defaultValue={String(hours.durationMins)} className="field-input">
              {INTERVIEW_DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor={`iv-where-${roleId}`} className="field-label">Where (a meeting link or an address, optional)</label>
          <input id={`iv-where-${roleId}`} name="interviewLocation" defaultValue={hours.location} maxLength={300} className="field-input" placeholder="https://teams.microsoft.com/... or 1 King Street, Manchester" />
        </div>
        <SubmitButton pendingLabel="Saving...">Save interview hours</SubmitButton>
      </ActionForm>
    </details>
  );
}
