import Link from "next/link";
import { getWorkspace } from "@/lib/workspace";
import { featureAvailability } from "@/lib/feature-access";
import { emailAllowance } from "@/lib/email-finder";
import { dismissRelease } from "@/app/actions/release";
import { canUseExtension } from "@/lib/extension-access";

export const dynamic = "force-dynamic";

// One release, written as the habits it changes. Nobody wants release notes;
// they want to know which of the things they do every day is different now,
// and what they have to do once before it works. What a plan does not include
// is left out, not teased.
export default async function WhatsNewPage() {
  const { owner, readOnly } = await getWorkspace();
  const features = await featureAvailability();
  const allowance = features.emailFinder ? await emailAllowance(owner) : null;
  const canDownload = !readOnly && canUseExtension(owner);

  return (
    <fieldset disabled={readOnly} className="min-w-0 max-w-3xl">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Retrivr / 21 October</p>
          <h1>What&rsquo;s new</h1>
          <p className="page-description">
            When you write to someone from an outreach run or a follow-up run, the same click can now open the message as an email
            too, ready to send from your own email app.
            {allowance && " And when you do not have their address, Retrivr can find their work email."}
          </p>
        </div>
      </header>

      <ol className="space-y-4">
        {allowance && (
          <li className="card space-y-2">
            <h2 className="text-lg">Find someone&rsquo;s work email</h2>
            <p className="text-ink/80">
              Press <em>Find email</em> on a person&rsquo;s page, beside a candidate on a role, or on the card in an outreach or
              follow-up run. Retrivr looks it up from their LinkedIn profile address, or, if that finds nothing, from their name and
              the company they work for, which you check first. It takes a few seconds and the address is saved on the person,
              marked <em>unverified</em>.
            </p>
            <p className="text-ink/80">
              Your plan has {allowance.quota} searches {allowance.trial ? "for your trial" : "a month"}, and only a search that finds
              an email counts. Each Find email says how many are left.
            </p>
            <p className="rounded border border-line bg-sunken p-3 text-sm">
              <strong>Before you write.</strong> They did not give you this address, so tell them where you found it and how to
              opt out, for example with <code className="font-mono">{"{{privacy_notice}}"}</code> in your template.
            </p>
          </li>
        )}

        <li className="card space-y-2">
          <h2 className="text-lg">Email them from the same click</h2>
          <p className="text-ink/80">
            When Retrivr has someone&rsquo;s email{allowance ? ", found, given when they booked, imported or added by you," : ", given when they booked, imported or added by you,"}{" "}
            the outreach card shows <em>Also email it to &hellip;</em>, ticked. <em>Copy and open</em> then also opens an email draft
            with the subject and your message in it. You send it from your own email app: Retrivr still sends nothing for you.
          </p>
          <p className="text-ink/80">
            <em>Mark as sent</em> records whether it went on LinkedIn, by email or both, and the person&rsquo;s page shows which.
            Untick the box to stay on LinkedIn only; Retrivr remembers your choice.
          </p>
          <p className="rounded border border-line bg-sunken p-3 text-sm">
            <strong>Adding an address by hand.</strong> Open the person and use <em>Add it by hand</em> under Email.
          </p>
          <p>
            <Link href="/people" className="btn-quiet">Open People</Link>
          </p>
        </li>
      </ol>

      <h2 className="mt-8 mb-3 section-heading">From 19 October, in case you missed it</h2>
      <div className="card space-y-2">
        <h2 className="text-lg">Retrivr is now at retrivr.app</h2>
        <p className="text-ink/80">
          Sign in at <strong>retrivr.app</strong>. The old <code className="font-mono">onrender.com</code> address, and the booking and
          client links you sent from it, still lead here. The browser extension needs the copy made for the new address: if yours
          is older, its panel says so.
          {canDownload && <> Download the new copy from <Link href="/account" className="text-accent underline">Your account</Link>,
          load it in <code className="font-mono">chrome://extensions</code>, then generate a new capture key in{" "}
          <Link href="/settings" className="text-accent underline">Settings</Link>.</>}
        </p>
      </div>

      {!readOnly && (
        <form action={dismissRelease} className="mt-6">
          <button type="submit" className="btn-primary">
            Got it
          </button>
        </form>
      )}
      <p className="mt-3 text-sm text-ink-soft">
        This page stays put until you press Got it or open Notifications, and the link in the top bar disappears with it.
      </p>
    </fieldset>
  );
}
