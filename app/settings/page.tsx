import Link from "next/link";
import { canUseExtension } from "@/lib/extension-access";
import { getSettings } from "@/lib/settings";
import { getWorkspace } from "@/lib/workspace";
import { updateSettings } from "@/app/actions/settings";
import { CaptureKeyPanel, ExtensionMark } from "@/components/CaptureKeyPanel";
import { ActionForm } from "@/components/ActionForm";
import { ExportPanel } from "@/components/ExportPanel";
import { bookingReadiness } from "@/lib/booking";
import { canUseFeature } from "@/lib/features";
import { notionConfigured, notionConnection } from "@/lib/notion";
import { disconnectNotion } from "@/app/actions/notion";
import { NotionLogo } from "@/components/NotionLogo";
import { factDate } from "@/lib/fact-labels";

export const dynamic = "force-dynamic";

// One column of sections, each a title and its purpose beside the controls,
// so the page reads top to bottom. The first two share one form and one Save;
// everything after acts as soon as it is used.
export default async function SettingsPage({ searchParams }: { searchParams: { notion?: string } }) {
  const { user, owner, readOnly } = await getWorkspace();
  // Apps to import from belong to the signed-in account, so a read-only view
  // of another workspace does not show them.
  const showApps = !readOnly && notionConfigured() && canUseFeature(user, "screening");
  const notion = showApps ? await notionConnection(user.id) : null;
  const settings = await getSettings();
  const extensionEnabled = canUseExtension(owner);
  const bookingReady = bookingReadiness(settings).ready;

  return (
    <fieldset key={owner.id} disabled={readOnly} className="min-w-0">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Workspace / Preferences</p>
          <h1>Settings</h1>
          <p className="page-description">Make Retrivr work the way you recruit.</p>
        </div>
      </header>
      <div className="settings-page">
        <ActionForm action={updateSettings} className="settings-form" messagesAtEnd>
          <section className="settings-section" aria-labelledby="details-heading">
            <div>
              <h2 id="details-heading" className="settings-section-title">Your details</h2>
              <p className="settings-section-text">How you sign the messages you send.</p>
            </div>
            <div className="settings-section-body">
              <div className="settings-field">
                <label htmlFor="recruiterName" className="settings-label">Your name</label>
                <input id="recruiterName" name="recruiterName" defaultValue={settings.recruiterName} className="field-input" aria-describedby="recruiterName-hint" />
                <p id="recruiterName-hint" className="settings-hint">Templates write it wherever they say <code className="settings-token">{"{{recruiter_name}}"}</code>.</p>
              </div>
            </div>
          </section>

          <section className="settings-section" aria-labelledby="scheduling-heading">
            <div>
              <h2 id="scheduling-heading" className="settings-section-title">Scheduling and follow-ups</h2>
              <p className="settings-section-text">How candidates book a call with you, and when Follow-ups reminds you to chase.</p>
            </div>
            <div className="settings-section-body">
              <div className="settings-field">
                <label htmlFor="calendarLink" className="settings-label">Calendar link</label>
                <input id="calendarLink" name="calendarLink" defaultValue={settings.calendarLink} className="field-input" placeholder="e.g. https://calendly.com/you/intro-call" aria-describedby="calendarLink-hint" />
                <p id="calendarLink-hint" className="settings-hint">Your own scheduling page, for <code className="settings-token">{"{{calendar_link}}"}</code> in templates.</p>
              </div>
              <div className="settings-row">
                <div className="min-w-0">
                  <p className="settings-label">
                    Booking page
                    <span className={`settings-status${bookingReady ? " is-on" : ""}`}>{bookingReady ? "On" : "Not set up"}</span>
                  </p>
                  <p className="settings-hint">
                    {bookingReady
                      ? <>Retrivr&rsquo;s own: <code className="settings-token">{"{{booking_link}}"}</code> in a template becomes each candidate&rsquo;s link.</>
                      : "Or let candidates pick a time from Retrivr's own page. Choose your hours and how the call happens."}
                  </p>
                </div>
                <Link href="/settings/booking" className="btn-secondary">{readOnly ? "View" : bookingReady ? "Change" : "Set up"}</Link>
              </div>
              <div className="settings-field" role="group" aria-labelledby="remind-heading">
                <p id="remind-heading" className="settings-label">Remind me</p>
                <div className="settings-inline">
                  <label htmlFor="bookingChaseDays">Chase a booking after</label>
                  <input id="bookingChaseDays" name="bookingChaseDays" type="number" min={1} defaultValue={settings.bookingChaseDays} className="field-input settings-number" />
                  <span aria-hidden="true">days</span>
                </div>
                <div className="settings-inline">
                  <label htmlFor="quietNudgeDays">Nudge quiet candidates after</label>
                  <input id="quietNudgeDays" name="quietNudgeDays" type="number" min={1} defaultValue={settings.quietNudgeDays} className="field-input settings-number" />
                  <span aria-hidden="true">days</span>
                </div>
              </div>
            </div>
          </section>

          <div className="settings-save">
            <button type="submit" className="btn-primary">Save changes</button>
            <p className="settings-hint">Saves your details and scheduling. Everything below changes as soon as you use it.</p>
          </div>
        </ActionForm>

        <section className="settings-section" aria-labelledby="connections-heading">
          <div>
            <h2 id="connections-heading" className="settings-section-title">Connections</h2>
            <p className="settings-section-text">The browser extension and the apps Retrivr can read from, on your click.</p>
          </div>
          <div className="settings-section-body">
            <div className="settings-integrations">
              {readOnly || extensionEnabled
                ? <CaptureKeyPanel enabled={Boolean(settings.captureTokenHash)} readOnly={readOnly} />
                : <div className="settings-integration" role="region" aria-label="Browser extension">
                  <div className="settings-integration-head">
                    <ExtensionMark />
                    <div className="min-w-0 flex-1">
                      <p className="settings-label">Browser extension<span className="settings-status">Needs a plan</span></p>
                      <p className="settings-hint">The extension and its key come with every plan and with the trial.</p>
                    </div>
                    <Link href="/billing" className="btn-secondary">Choose a plan</Link>
                  </div>
                </div>}
              {showApps && (
                <div className="settings-integration" role="region" aria-label="Notion">
                  <div className="settings-integration-head">
                    <span className="settings-app-icon"><NotionLogo size={24} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="settings-label">Notion<span className={`settings-status${notion ? " is-on" : ""}`}>{notion ? "Connected" : "Not connected"}</span></p>
                      <p className="settings-hint">
                        {notion
                          ? `Connected${notion.label ? ` to ${notion.label}` : ""} on ${factDate.format(notion.connectedAt)}. Import meeting notes into a screening call; Retrivr reads only the pages you choose.`
                          : "Import meeting notes into a screening call. Retrivr reads only the pages you choose, when you import one."}
                      </p>
                      {searchParams.notion === "failed" && <p role="alert" className="settings-hint is-error">It could not be connected. Try again.</p>}
                      {notion?.lastErrorAt && <p role="alert" className="settings-hint is-error">The last import could not reach Notion. Connect again if it keeps happening.</p>}
                    </div>
                    <div className="settings-integration-actions">
                      <a href="/api/notion/connect?return=%2Fsettings" className="btn-secondary">{notion ? "Choose pages again" : "Connect Notion"}</a>
                      {notion && (
                        <form action={disconnectNotion}>
                          <button type="submit" className="settings-link-button is-danger">Disconnect</button>
                        </form>
                      )}
                    </div>
                  </div>
                  {notion && <p className="settings-hint settings-integration-note">Disconnecting deletes Retrivr&rsquo;s access token. To remove Retrivr from Notion as well, open Settings, then Connections, in Notion.</p>}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="data-heading">
          <div>
            <h2 id="data-heading" className="settings-section-title">Your data</h2>
            <p className="settings-section-text">Everything you have recorded in Retrivr, to keep or take elsewhere. It stays yours whichever plan you are on.</p>
          </div>
          <div className="settings-section-body">
            {readOnly
              ? <p className="settings-hint">Exports are only available from your own workspace.</p>
              : <ExportPanel />}
          </div>
        </section>
      </div>
    </fieldset>
  );
}
