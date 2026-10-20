import Link from "next/link";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { activeShortlistLimit } from "@/lib/features";
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
  const limit = activeShortlistLimit(owner);
  const openRole = await db.role.findFirst({ where: { userId: owner.id, status: "open" }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true } });
  const canDownload = !readOnly && canUseExtension(owner);

  return (
    <fieldset disabled={readOnly} className="min-w-0 max-w-3xl">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Retrivr / 19 October</p>
          <h1>What&rsquo;s new</h1>
          <p className="page-description">
            Retrivr has a new address, <strong>retrivr.app</strong>. Sign in there from now on, and load the new copy of the browser
            extension, once.
          </p>
        </div>
      </header>

      <section aria-label="This version" className="card space-y-3">
        <h2 className="text-lg">Retrivr is now at retrivr.app</h2>
        <p className="text-ink/80">
          Everything you have in Retrivr is here, unchanged. The old <code className="font-mono">onrender.com</code> address sends you
          to the same page here, so bookmarks still work, and so do the booking links and client links you have already sent:
          candidates and clients who open them land here without noticing. You sign in once more on the new address, because a
          browser keeps a sign-in per address.
        </p>
        <h2 className="text-lg">The extension needs the new address</h2>
        <p className="text-ink/80">
          Chrome lets an extension reach only the address it was made for. Your copy keeps saving people until you replace it, but
          only this new copy works with <strong>retrivr.app</strong>. If you have not updated since 18 October, it also brings the
          panel that keeps up as you move from profile to profile, and <em>Open this role</em> going to Retrivr after a save.
        </p>
        {currentRelease.extension && <>
          <p className="rounded border border-line bg-sunken p-3 text-sm">
            <strong>One thing to do.</strong> Download the new copy. In <code className="font-mono">chrome://extensions</code>, remove the
            old copy and load the new folder. Then generate a new capture key in{" "}
            <Link href="/settings" className="text-accent underline">Settings</Link> and paste it into the extension. If you load the new
            folder over the old one instead, change the address in the extension to{" "}
            <code className="font-mono">https://retrivr.app</code>.
          </p>
          {canDownload && (
            <p>
              <a href="/api/extension/download" download className="btn-primary">Download the new extension<Icon name="down" size={16} /></a>
            </p>
          )}
        </>}
      </section>

      <h2 className="mt-8 mb-3 section-heading">From 18 October, in case you missed it</h2>
      <ol className="space-y-4">
        <li className="card space-y-2">
          <h2 className="text-lg">Show a client who you found, on one page</h2>
          <p className="text-ink/80">
            On a role, press <em>Put forward</em> beside a candidate who agreed to be put forward to that client. They appear on the
            role&rsquo;s <strong>Client link</strong>: a page your client opens without signing in, showing their headline, the facts they
            confirmed with you, their skills and why they would move. Never their LinkedIn, their contact details or your notes.
          </p>
          <p className="text-ink/80">
            Send the link from your own email. Your client presses <em>Interview</em> or <em>Not for us</em> on each person, and
            whoever they want to meet appears under <em>Client wants to meet</em> in Follow-ups. You can share the page only with
            named people instead, and close or replace the link at any time.
          </p>
          {openRole && (
            <p>
              <Link href={`/roles/${openRole.id}`} className="btn-quiet">Open {openRole.title}</Link>
            </p>
          )}
        </li>

        <li className="card space-y-2">
          <h2 className="text-lg">Shortlists for a client, beyond one role</h2>
          <p className="text-ink/80">
            Tick people on <strong>People</strong>, or open someone&rsquo;s page, and put them on a shortlist for a client: the same kind
            of page, for anyone you know, open for 60 days. Retrivr remembers who already agreed to be put forward to that client.
          </p>
          {limit !== null && (
            <p className="text-sm text-ink-soft">Your plan keeps {limit} shortlists open at once; closed and expired ones do not count.</p>
          )}
          <p>
            <Link href="/shortlists" className="btn-quiet">Open Shortlists</Link>
          </p>
        </li>

        <li className="card space-y-2">
          <h2 className="text-lg">Candidates book the client&rsquo;s interview</h2>
          <p className="text-ink/80">
            Put <code className="font-mono">{"{{interview_link}}"}</code> in a template, or use Retrivr&rsquo;s own follow-up, and each
            person the client wants to meet gets a link to the times you offer them. Two people can never take the same time with
            one client, and the client sees every booked interview on their page, with a calendar file and a way to say they cannot
            make it.
          </p>
          <p className="rounded border border-line bg-sunken p-3 text-sm">
            <strong>Nothing to set up per client.</strong> When a client wants to meet someone, press <em>Arrange interview</em> on
            their row: set the time you agreed, or offer two or three for them to pick from.
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
