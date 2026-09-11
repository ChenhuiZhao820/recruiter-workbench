import Link from "next/link";
import { getOnboardingStatus, type OnboardingStepId } from "@/lib/onboarding";
import { getWorkspace } from "@/lib/workspace";
import { ExtensionActivationForm } from "@/components/AccountForms";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

type Content = {
  title: string;
  summary: string;
  detail?: React.ReactNode;
  doneNote: string;
  action?: React.ReactNode;
};

export default async function GettingStartedPage() {
  const { user, readOnly } = await getWorkspace();
  const status = await getOnboardingStatus();
  const firstName = user.name.trim().split(/\s+/)[0] || user.name;
  const next = status.steps.find((step) => !step.done);

  const content: Record<OnboardingStepId, Content> = {
    password: {
      title: "Set your password",
      summary: "Your administrator sent a one-time setup link. Opening it and choosing a password created your sign-in.",
      doneNote: "You are signed in, so this one is behind you.",
      action: <Link href="/account" className="btn-secondary">Change your password</Link>,
    },
    profile: {
      title: "Add your outreach details",
      summary: "Your name and calendar link fill the placeholders your message templates use, so drafts read as yours from the first one.",
      detail: <p>Set your name in Settings. A calendar link is optional, but templates that offer a time work better with one.</p>,
      doneNote: status.recruiterName
        ? `Templates sign your messages as ${status.recruiterName}${status.hasCalendarLink ? ", and your calendar link is saved." : ". A calendar link is still optional."}`
        : "Saved.",
      action: <Link href="/settings" className="btn-primary">Open Settings<Icon name="arrow" size={17} /></Link>,
    },
    role: {
      title: "Create your first open role",
      summary: "Everything in Capture hangs off a role: candidates, saved searches, follow-ups, and anything the extension saves.",
      detail: <p>Add the title and client now. The job description and its briefing can follow later.</p>,
      doneNote: "You have an open role, so saved profiles have somewhere to land.",
      action: status.openRoleId
        ? <Link href={`/roles/${status.openRoleId}`} className="btn-secondary">Open your role</Link>
        : <Link href="/roles/new" className="btn-primary"><Icon name="plus" size={18} />New role</Link>,
    },
    extension: {
      title: "Activate extension access",
      summary: "Extension access is granted per account. Ask your administrator for your activation code, then redeem it here.",
      detail: <>
        <p>A code works once, for your account only, and expires 7 days after it is issued. A replacement code invalidates the previous one.</p>
        {status.extensionCodeExpired && <p role="status">Your activation code has expired. Ask your administrator for a replacement.</p>}
      </>,
      doneNote: status.isAdmin ? "Administrator access includes the extension; no code is needed." : "Extension access is activated for this account.",
      action: status.isAdmin || status.extensionEnabled ? undefined : <ExtensionActivationForm />,
    },
    install: {
      title: "Install the extension in Chrome",
      summary: "Download the ZIP and load it as an unpacked extension. This part happens on your own computer, so Capture cannot tick it off for you.",
      detail: <ol className="onboarding-substeps">
        <li>Extract the ZIP into a permanent folder. Keep that folder after installing: an unpacked extension is loaded from where it sits.</li>
        <li>In desktop Chrome, open <code>chrome://extensions</code>, turn on <strong>Developer mode</strong>, choose <strong>Load unpacked</strong>, and select the extracted <code>capture-extension</code> folder containing <code>manifest.json</code>.</li>
        <li>Pin Capture from Chrome&rsquo;s extensions menu so the toolbar button is one click away.</li>
      </ol>,
      doneNote: "Download the ZIP again whenever you reinstall or update. Unpacked extensions do not update themselves.",
      action: status.extensionEnabled
        ? <a href="/api/extension/download" download className="btn-primary">Download extension ZIP<Icon name="down" size={17} /></a>
        : <p className="onboarding-blocked"><Icon name="lock" size={15} />Activate extension access first.</p>,
    },
    captureKey: {
      title: "Generate your capture key and connect",
      summary: "The capture key identifies your account to the extension, separately from your website sign-in.",
      detail: <>
        <p>Generate the key in Settings and paste it into the extension; the workbench address is already filled in. Then click Connect and check that the extension shows your name and email.</p>
        <p><strong>Copy the key before you leave that page: it is shown once and cannot be displayed again.</strong> If you lose it, generate another one. That replaces the old key rather than recovering it.</p>
      </>,
      doneNote: "A capture key exists for this account. Generate a new one in Settings if you need to reconnect; the old key stops working.",
      action: status.extensionEnabled
        ? <Link href="/settings" className="btn-primary">Generate a capture key<Icon name="arrow" size={17} /></Link>
        : <p className="onboarding-blocked"><Icon name="lock" size={15} />Activate extension access first.</p>,
    },
  };

  return <div className="onboarding-page">
    <header className="page-header">
      <div>
        <p className="page-eyebrow">Workspace / Getting started</p>
        <h1>{status.complete ? `You are set up, ${firstName}.` : `Welcome, ${firstName}.`}</h1>
        <p className="page-description">{status.complete
          ? "Every setup step is done. Keep this page for reinstalling the extension or connecting a new computer."
          : "Six short steps take a new account to a connected workspace. Each one is saved as you go, so you can stop and come back."}</p>
      </div>
      <span aria-hidden="true" className="onboarding-badge"><Icon name="spark" size={22} /></span>
    </header>

    {readOnly ? <p className="card text-sm text-ink-soft">Setup is personal to each account. Return to your own workspace to work through these steps; nothing here can be completed in a read-only view.</p> : <>
      <section className="onboarding-progress" aria-label="Setup progress">
        <div>
          <p className="eyebrow">SETUP PROGRESS</p>
          <strong>{status.done} of {status.total} done</strong>
          <span>{status.complete ? "Nothing left to configure." : `Next: ${content[next!.id].title}.`}</span>
        </div>
        <div className="onboarding-meter" role="img" aria-label={`${status.done} of ${status.total} setup steps complete`}>
          <span style={{ width: `${Math.round((status.done / status.total) * 100)}%` }} />
        </div>
      </section>

      <ol className="onboarding-steps">
        {status.steps.map((step, index) => {
          const item = content[step.id];
          const isNext = next?.id === step.id;
          const state = step.done ? (step.manual ? "Ready" : "Done") : isNext ? "Next" : step.manual ? "On your computer" : "To do";
          return <li key={step.id} className={`onboarding-step${step.done ? " is-done" : ""}${isNext ? " is-next" : ""}`}>
            <span aria-hidden="true" className="onboarding-marker">{step.done ? <Icon name="check" size={16} /> : String(index + 1).padStart(2, "0")}</span>
            <div className="onboarding-step-body">
              <div className="onboarding-step-head">
                <h2>{item.title}</h2>
                <span className="chip">{state}</span>
              </div>
              <p className="onboarding-summary">{item.summary}</p>
              {step.done ? <p className="onboarding-note">{item.doneNote}</p> : <div className="onboarding-detail">{item.detail}</div>}
              {item.action && <div className="onboarding-action">{item.action}</div>}
            </div>
          </li>;
        })}
      </ol>

      <section className="onboarding-help" aria-label="If something goes wrong">
        <h2>If something does not line up</h2>
        <ul>
          <li>No activation code, or an expired one: your administrator issues and replaces codes. A forwarded ZIP does not grant access.</li>
          <li>Chrome refuses Developer mode: your organisation may block unpacked extensions. Ask your IT administrator.</li>
          <li>The extension cannot connect: check that you pasted the most recent capture key. Changing your password revokes the key, so generate a new one afterwards.</li>
          <li>Nothing to save a profile to: create an open role first. The extension only offers your open roles.</li>
        </ul>
        <Link href="/welcome" className="text-link">What Capture does<Icon name="arrow" size={16} /></Link>
      </section>
    </>}
  </div>;
}
