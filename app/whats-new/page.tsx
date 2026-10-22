import Link from "next/link";
import { getWorkspace } from "@/lib/workspace";
import { featureAvailability } from "@/lib/feature-access";
import { emailAllowance } from "@/lib/email-finder";
import { dismissRelease } from "@/app/actions/release";
import { currentRelease } from "@/lib/release";
import { canUseExtension } from "@/lib/extension-access";
import { Icon } from "@/components/Icon";

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
          <p className="page-eyebrow">Retrivr / 22 October</p>
          <h1>What&rsquo;s new</h1>
          <p className="page-description">
            {allowance
              ? "The browser extension can now find someone's email while you save them."
              : "The browser extension now takes someone's email while you save them."}{" "}
            And a candidate&rsquo;s row on a role is tidier. Load the new copy of the extension, once.
          </p>
        </div>
      </header>

      <section aria-label="This version" className="space-y-4">
        <div className="card space-y-3">
          <h2 className="text-lg">{allowance ? "Find their email from the extension" : "Their email, in the extension"}</h2>
          <p className="text-ink/80">
            Below the profile link there is now an <em>Email</em> field.
            {allowance
              ? <> Press the green <em>Find email</em> beside it and Retrivr looks the address up from the LinkedIn profile you are on.
                It fills the field and says <em>Found</em>, or says it cannot be found and that no search was used. The searches left
                show above the field, and only one that finds an email counts.</>
              : " Type an address there and it is saved on the person with them."}{" "}
            Someone you already keep an email for shows it there. Saving never replaces an address you already keep.
          </p>
          <p className="text-ink/80">
            The extension is now called Retrivr in Chrome, with Retrivr&rsquo;s logo at the top of the panel. Warnings in it are plain
            red words, and the panel no longer repeats that it works apart from your website sign-in.
          </p>
          {currentRelease.extension && <>
            <p className="rounded border border-line bg-sunken p-3 text-sm">
              <strong>One thing to do.</strong> Download the new copy. In <code className="font-mono">chrome://extensions</code>, remove
              the old copy and load the new folder, then generate a new extension key in{" "}
              <Link href="/settings" className="text-accent underline">Settings</Link> and paste it into the extension. Loading the new
              folder over the old one instead keeps your key.
            </p>
            {canDownload && (
              <p>
                <a href="/api/extension/download" download className="btn-primary">Download the new extension<Icon name="down" size={16} /></a>
              </p>
            )}
          </>}
        </div>

        <div className="card space-y-2">
          <h2 className="text-lg">A candidate&rsquo;s row, tidied</h2>
          <p className="text-ink/80">
            On a role, the pencil beside a name edits their details{allowance ? ", with Find email beside their email," : ","} and the
            bin removes them, each asking first. The stage is a menu in the corner: pick one and it is saved. <em>Arrange interview</em>{" "}
            appears when the client asks to meet someone, and what the client said is one line where <em>Put forward</em> was.
          </p>
        </div>
      </section>

      <h2 className="mt-8 mb-3 section-heading">From 21 October, in case you missed it</h2>
      <ol className="space-y-4">
        {allowance && (
          <li className="card space-y-2">
            <h2 className="text-lg">Find someone&rsquo;s work email</h2>
            <p className="text-ink/80">
              Press <em>Find email</em> on a person&rsquo;s page, in a candidate&rsquo;s details on a role, or on the card in an outreach
              or follow-up run. The address is saved on the person, marked <em>unverified</em>.
            </p>
            <p className="text-ink/80">
              Your plan has {allowance.quota} searches {allowance.trial ? "for your trial" : "a month"}, and only a search that finds
              an email counts.
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
            When Retrivr has someone&rsquo;s email, the outreach card shows <em>Also email it to &hellip;</em>, and <em>Copy and
            open</em> also opens an email draft for your own email app. <em>Mark as sent</em> records whether it went on LinkedIn,
            by email or both.
          </p>
          <p>
            <Link href="/people" className="btn-quiet">Open People</Link>
          </p>
        </li>
      </ol>

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
