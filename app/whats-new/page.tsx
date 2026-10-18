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
  const access = currentRelease.extension ? await db.extensionAccess.findUnique({ where: { userId: owner.id }, select: { activatedAt: true } }) : null;
  const canDownload = !readOnly && canUseExtension({ ...owner, extensionAccess: access });

  return (
    <fieldset disabled={readOnly} className="min-w-0 max-w-3xl">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Capture / 18 October</p>
          <h1>What&rsquo;s new</h1>
          <p className="page-description">
            Your client can now see who you found, say who they want to meet, and have those people book the interview themselves,
            without an account and without you passing emails back and forth.
          </p>
        </div>
      </header>

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
            of page, for anyone you know, open for 60 days. Capture remembers who already agreed to be put forward to that client.
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
            Put <code className="font-mono">{"{{interview_link}}"}</code> in a template, or use Capture&rsquo;s own follow-up, and each
            person the client wants to meet gets a link to the client&rsquo;s free times. Two people can never take the same time with
            one client, and the client sees every booked interview on their page, with a calendar file and a way to say they cannot
            make it.
          </p>
          <p className="rounded border border-line bg-sunken p-3 text-sm">
            <strong>One thing to do per client.</strong> Set when they interview, under <em>Interview hours</em> in the role&rsquo;s
            Client link. The next role for the same client starts with the same hours. If you skip it, the client is asked on their page.
          </p>
          <p className="text-ink/80">
            If a client does not need to review first, switch the role to <em>Candidates book straight away</em> and anyone you put
            forward can book at once.
          </p>
        </li>
      </ol>

      {currentRelease.extension ? (
        <div className="mt-6 card space-y-2">
          <h2 className="text-lg">This version needs a new copy of the browser extension</h2>
          <p className="text-ink/80">
            Chrome does not update an extension you loaded yourself. Download the new copy, load it in{" "}
            <code className="font-mono">chrome://extensions</code>, then generate a new capture key in{" "}
            <Link href="/settings" className="text-accent underline">Settings</Link> and paste it into the extension.
          </p>
          {canDownload && (
            <p>
              <a href="/api/extension/download" download className="btn-quiet">Download the new extension<Icon name="down" size={15} /></a>
            </p>
          )}
        </div>
      ) : (
        <p className="mt-6 text-sm text-ink-soft">
          No new copy of the browser extension is needed this time.
        </p>
      )}
      {!readOnly && (
        <form action={dismissRelease} className="mt-6">
          <button type="submit" className="btn-primary">
            Got it
          </button>
        </form>
      )}
      <p className="mt-3 text-sm text-ink-soft">
        This page stays put until you press Got it, and the link in the top bar disappears with it.
      </p>
    </fieldset>
  );
}
