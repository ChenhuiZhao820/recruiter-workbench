import { getSettings } from "@/lib/settings";
import { updateSettings } from "@/app/actions/settings";
import { ActionForm } from "@/components/ActionForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSettings();

  return (
    <div className="max-w-xl">
      <h1 className="mb-6 text-3xl">Settings</h1>
      <ActionForm action={updateSettings} className="card space-y-4">
        <div>
          <label htmlFor="recruiterName" className="field-label">
            Your name (used in message templates as {"{{recruiter_name}}"})
          </label>
          <input
            id="recruiterName"
            name="recruiterName"
            defaultValue={settings.recruiterName}
            className="field-input"
          />
        </div>
        <div>
          <label htmlFor="calendarLink" className="field-label">
            Calendar link (used in message templates)
          </label>
          <input
            id="calendarLink"
            name="calendarLink"
            defaultValue={settings.calendarLink}
            className="field-input"
            placeholder="https://calendly.com/you/intro-call"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="bookingChaseDays" className="field-label">
              Chase a booking after (days)
            </label>
            <input
              id="bookingChaseDays"
              name="bookingChaseDays"
              type="number"
              min={1}
              defaultValue={settings.bookingChaseDays}
              className="field-input"
            />
          </div>
          <div>
            <label htmlFor="quietNudgeDays" className="field-label">
              Nudge quiet candidates after (days)
            </label>
            <input
              id="quietNudgeDays"
              name="quietNudgeDays"
              type="number"
              min={1}
              defaultValue={settings.quietNudgeDays}
              className="field-input"
            />
          </div>
        </div>
        <button type="submit" className="btn-primary">
          Save settings
        </button>
      </ActionForm>
      <p className="mt-4 text-sm text-ink/60">
        The briefing API key lives on the server, in the .env file. It is never shown here or
        sent to the browser.
      </p>
    </div>
  );
}
