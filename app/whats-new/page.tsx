import Link from "next/link";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { dismissRelease } from "@/app/actions/release";
import { parseIndustries } from "@/lib/linkedin-industries";

export const dynamic = "force-dynamic";

// One release, written as the habits it changes. Nobody wants release notes;
// they want to know which of the things they do every day is different now,
// and what they have to do once before it works.
export default async function WhatsNewPage() {
  const { owner, readOnly } = await getWorkspace();

  // Two links that only help if they lead somewhere real, so they are only
  // offered when they do.
  const [role, searches] = await Promise.all([
    db.role.findFirst({
      where: { userId: owner.id, status: "open", candidates: { some: {} } },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
    }),
    db.savedSearch.findMany({
      where: { userId: owner.id },
      select: { id: true, name: true, industries: true },
    }),
  ]);

  // Industries written before the picker existed are the recruiter's own
  // wording with no LinkedIn id behind them, so they cannot reach a search URL
  // until they are picked again. It is the one piece of old data worth a word.
  const needsIndustries = searches.filter((s) =>
    parseIndustries(s.industries).some((entry) => !entry.id)
  );

  return (
    <fieldset disabled={readOnly} className="min-w-0 max-w-3xl">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Capture / 24 September</p>
          <h1>What&rsquo;s new</h1>
          <p className="page-description">Three things you do every day work differently now.</p>
        </div>
      </header>

      <ol className="space-y-4">
        <li className="card space-y-2">
          <h2 className="text-lg">Industries are LinkedIn&rsquo;s own list now</h2>
          <p className="text-ink/80">
            You used to write an industry here and then read LinkedIn&rsquo;s taxonomy and tick
            the boxes again over there. Now you type how you talk &mdash; pharma, logistics,
            manufacturing &mdash; and pick from the entries LinkedIn actually recognises.
          </p>
          <p className="text-ink/80">
            An ordinary LinkedIn search then opens with those industries already applied.
            Recruiter keeps its filters to itself, so there you get the exact names to paste
            into its own filter, with a copy button next to them.
          </p>
          {needsIndustries.length > 0 && (
            <p className="rounded border border-line bg-sunken p-3 text-sm">
              <strong>One thing to do once.</strong>{" "}
              {needsIndustries.length === 1 ? "One saved search still uses" : `${needsIndustries.length} saved searches still use`}{" "}
              your own wording, which cannot travel in a search address. Open{" "}
              {needsIndustries.slice(0, 3).map((s, i) => (
                <span key={s.id}>
                  {i > 0 ? ", " : ""}
                  <Link href={`/searches/${s.id}/edit`} className="underline">
                    {s.name}
                  </Link>
                </span>
              ))}
              {needsIndustries.length > 3 ? ` and ${needsIndustries.length - 3} more` : ""} and the
              picker offers the closest real entries.
            </p>
          )}
          <p>
            <Link href="/searches" className="btn-quiet">
              Go to Searches
            </Link>
          </p>
        </li>

        <li className="card space-y-2">
          <h2 className="text-lg">Send outreach walks the shortlist for you</h2>
          <p className="text-ink/80">
            The trip between messages is gone: no going back to the role, finding the next name,
            opening it and picking the same template again. Pick a template and tick the shortlist
            once, then each person arrives with their message already written and editable.
          </p>
          <p className="text-ink/80">
            One button copies it and opens LinkedIn &mdash; at the message box itself for anyone
            the extension saved, at their profile otherwise. Paste, read it, send it, then
            <em> Mark as sent and next</em>. Nothing sends itself, and it never moves on without
            you.
          </p>
          <p>
            {role ? (
              <Link href={`/roles/${role.id}/outreach`} className="btn-quiet">
                Try it on {role.title}
              </Link>
            ) : (
              <Link href="/" className="btn-quiet">
                Open a role with candidates on it
              </Link>
            )}
          </p>
        </li>

        <li className="card space-y-2">
          <h2 className="text-lg">The Capture panel can follow you</h2>
          <p className="text-ink/80">
            The panel stays open as you walk from profile to profile. Until now it could not read
            each new one without another click on the toolbar icon, because Chrome takes that
            access back the moment a tab moves.
          </p>
          <p className="text-ink/80">
            The panel now offers a button that asks Chrome for permission to read LinkedIn. Allow
            it and every profile you open fills the panel in as you go; refuse and nothing changes
            at all. <em>Pause</em> stops the reading without closing the panel, and Chrome&rsquo;s
            own settings take the permission back. It also tells you when someone is already on
            one of your roles, before you save them twice.
          </p>
          <div className="rounded border border-line bg-sunken p-3 text-sm">
            <strong>This one needs a new copy of the extension.</strong> Chrome does not update an
            extension you loaded yourself, so:
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>
                Download it again from{" "}
                <Link href="/account" className="underline">
                  Your account
                </Link>
                .
              </li>
              <li>Unzip it over the folder you installed from, replacing the files.</li>
              <li>
                Open <code className="font-mono">chrome://extensions</code> and press Reload on
                Capture.
              </li>
            </ol>
            <p className="mt-2">
              Your capture key and your connection are untouched; you do not have to set it up
              again. Future updates will say so in the panel itself.
            </p>
          </div>
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
        This page stays put until you press Got it, and the link in the top bar disappears with it.
      </p>
    </fieldset>
  );
}
