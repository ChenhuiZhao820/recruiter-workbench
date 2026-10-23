import Image from "next/image";
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
          <p className="page-eyebrow">Retrivr / 23 October</p>
          <h1>What&rsquo;s new</h1>
          <p className="page-description">A new copy of the browser extension.</p>
        </div>
      </header>

      <section aria-label="This version" className="card space-y-5">
        <h2 className="text-lg">{allowance ? "Find more emails with the company name" : "Their company, next to their name"}</h2>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <Image
            src={allowance ? "/whats-new/extension-company.png" : "/whats-new/extension-company-plain.png"}
            alt="The extension with Company name filled in next to Name"
            width={316}
            height={589}
            className="w-full max-w-[260px] flex-none rounded border border-line"
          />
          <div className="min-w-0 space-y-3 text-ink/80">
            <p>
              The extension now picks up the company from the LinkedIn profile you&rsquo;re on and puts it next to the name. You can
              fix it if it&rsquo;s wrong.
              {allowance && <> <em>Find email</em> then searches with the name and company, which finds more people than the profile
                link alone.</>}
            </p>
            {allowance && <>
              <p>
                If it can&rsquo;t find an email, or finds one that&rsquo;s clearly wrong, open <em>Settings</em> in the extension,
                switch <em>Find email by</em> to <em>LinkedIn link</em>, and try again.
              </p>
              <Image
                src="/whats-new/extension-email-by.png"
                alt="Find email by, with Company name and LinkedIn link to choose from"
                width={314}
                height={77}
                className="w-full max-w-[314px] rounded border border-line"
              />
            </>}
          </div>
        </div>
        {currentRelease.extension && <>
          <p className="rounded border border-line bg-sunken p-3 text-sm">
            <strong>One thing to do.</strong> Download the new extension. In <code className="font-mono">chrome://extensions</code>,
            remove the old Retrivr and load the new <code className="font-mono">retrivr-extension</code> folder. Then generate a new
            extension key in <Link href="/settings" className="text-accent underline">Settings</Link> and paste it in.
          </p>
          {canDownload && (
            <p>
              <a href="/api/extension/download" download className="btn-primary">Download the new extension<Icon name="down" size={16} /></a>
            </p>
          )}
        </>}
      </section>

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
