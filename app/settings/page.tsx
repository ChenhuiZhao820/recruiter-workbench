import Link from "next/link";
import { db } from "@/lib/db";
import { canUseExtension } from "@/lib/extension-access";
import { getSettings } from "@/lib/settings";
import { getWorkspace } from "@/lib/workspace";
import { updateSettings } from "@/app/actions/settings";
import { CaptureKeyPanel } from "@/components/CaptureKeyPanel";
import { ActionForm } from "@/components/ActionForm";

export const dynamic = "force-dynamic";

const exportTables = [
  { id: "people", label: "People" },
  { id: "candidates", label: "Candidates" },
  { id: "roles", label: "Roles" },
  { id: "screenings", label: "Screenings" },
  { id: "bookings", label: "Bookings" },
  { id: "outreach", label: "Messages" },
  { id: "templates", label: "Templates" },
  { id: "searches", label: "Searches" },
] as const;

export default async function SettingsPage() {
  const { owner, readOnly } = await getWorkspace();
  const settings = await getSettings();
  const access = await db.extensionAccess.findUnique({ where: { userId: owner.id }, select: { activatedAt: true } });
  const extensionEnabled = canUseExtension({ ...owner, extensionAccess: access });

  return (
    <fieldset key={owner.id} disabled={readOnly} className="min-w-0">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Workspace / Preferences</p>
          <h1>Settings</h1>
          <p className="page-description">Make Capture work the way you recruit.</p>
        </div>
      </header>
      <div className="grid items-start gap-8 lg:grid-cols-[1.2fr_1fr]">
      <ActionForm action={updateSettings} className="card form-panel space-y-6">
        <div>
          <h2 className="section-heading"><span aria-hidden="true" className="section-number">01</span> Outreach defaults</h2>
          <p className="section-caption">The personal details your message templates use.</p>
        </div>
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
      <div className="min-w-0 space-y-10">
      <section className="min-w-0 space-y-5" aria-labelledby="data-heading">
        <div>
          <h2 id="data-heading" className="section-heading"><span aria-hidden="true" className="section-number">02</span> Your data</h2>
          <p className="section-caption">Everything you have recorded in Capture, to keep or take elsewhere. It stays yours whichever plan you are on.</p>
        </div>
        {readOnly ? (
          <p className="text-sm text-ink-soft">Exports are only available from your own workspace.</p>
        ) : (
          <div className="card space-y-4">
            <div>
              <a href="/api/export?format=json" className="btn-secondary" download>Download everything (JSON)</a>
              <p className="section-caption">One file with people, roles, candidates, screenings, bookings, messages, templates and searches.</p>
            </div>
            <div>
              <p className="text-sm font-medium">Or one spreadsheet (CSV) per table</p>
              <div className="data-export-links mt-2">
                {exportTables.map((table) => (
                  <a key={table.id} href={`/api/export?format=csv&table=${table.id}`} className="btn-quiet" download>{table.label}</a>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
      <section className="min-w-0 space-y-5" aria-label="Capture connection">
        <div>
          <h2 className="section-heading"><span aria-hidden="true" className="section-number">03</span> Browser connection</h2>
          <p className="section-caption">Connect the Capture extension to your workspace.</p>
        </div>
        {readOnly || extensionEnabled ? <>
          <CaptureKeyPanel enabled={Boolean(settings.captureTokenHash)} readOnly={readOnly} />
          {!readOnly && <Link href="/account" className="text-sm text-accent underline">Download extension and installation instructions</Link>}
        </> : <div className="card space-y-3">
          <h2 className="text-lg">Activate extension access first</h2>
          <p className="text-sm text-ink-soft">Redeem the extension activation code from your administrator in Your account before generating a capture key.</p>
          <Link href="/account" className="btn-secondary">Activate extension in your account</Link>
          <Link href="/getting-started" className="block text-sm text-accent underline">Open the step-by-step setup guide</Link>
        </div>}
      </section>
      </div>
      </div>

      <p className="mt-8 max-w-2xl border-t border-line pt-5 text-sm leading-relaxed text-ink-soft">
        The briefing API key lives on the server, in the .env file. It is never shown here or
        sent to the browser.
      </p>
    </fieldset>
  );
}
