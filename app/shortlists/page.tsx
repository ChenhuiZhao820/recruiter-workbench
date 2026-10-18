import Link from "next/link";
import { db } from "@/lib/db";
import { requireFeature } from "@/lib/feature-access";
import { activeShortlistLimit } from "@/lib/features";
import { getSettings } from "@/lib/settings";
import { formatWhen } from "@/lib/dates";
import { factDate } from "@/lib/fact-labels";
import { DECISION_REASON_LABELS, shortlistStatus } from "@/lib/shortlist-core.mjs";
import { closeShortlist, keepShortlistOpen, newShortlistLink, removeFromShortlist, renameShortlist } from "@/app/actions/custom-shortlists";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { ShortlistSharing } from "@/components/ShortlistSharing";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

// A library, like Templates: each shortlist is one collapsed row with its
// name, client and state, opened to share it, see who is on it and what the
// client said, or close it. Making a new one lives on /shortlists/new.

const STATUS_LABELS: Record<string, string> = { active: "Open", expired: "Expired", revoked: "Closed", closed: "Closed" };

export default async function ShortlistsPage({ searchParams }: { searchParams: { open?: string } }) {
  const { owner, readOnly } = await requireFeature("clientShortlists");
  const now = new Date();
  const settings = await getSettings();
  const shortlists = await db.shortlist.findMany({
    where: { userId: owner.id, kind: "custom" },
    orderBy: { createdAt: "desc" },
    include: {
      accesses: { orderBy: { createdAt: "asc" } },
      items: {
        orderBy: [{ position: "asc" }, { addedAt: "asc" }],
        include: { person: { select: { id: true, fullName: true, headline: true, doNotContact: true } } },
      },
    },
  });
  const rows = shortlists
    .map((shortlist) => ({ shortlist, status: shortlistStatus(shortlist, null, now) }))
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active"));
  const active = rows.filter((row) => row.status === "active").length;
  const limit = activeShortlistLimit(owner, now);
  const atLimit = limit !== null && active >= limit;

  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-8">
      <header className="page-header">
        <div>
          <h1>Shortlists</h1>
          <p className="page-description">
            People you would like a client to meet, on a page they open without signing in. Each role also has its own client link, on the role&rsquo;s page.
          </p>
        </div>
        {!readOnly && (
          atLimit
            ? <span className="btn-primary" aria-disabled="true" data-disabled="true"><Icon name="plus" size={16} />New shortlist</span>
            : <Link href="/shortlists/new" className="btn-primary"><Icon name="plus" size={16} />New shortlist</Link>
        )}
      </header>

      {limit !== null && (
        <p className={`shortlist-limit${atLimit ? " is-full" : ""}`}>
          <strong className="tabular">{active} of {limit}</strong> active shortlists on your plan.
          {atLimit ? " Close one, or let one expire, to open another. Links you already sent keep working." : " Closed and expired ones do not count."}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="card empty-state">
          <span className="empty-state-icon"><Icon name="people" size={26} /></span>
          <h3>No shortlists yet</h3>
          <p>Choose people on People, or from a person&rsquo;s page, and put them on a shortlist for a client.</p>
          {!readOnly && <Link href="/shortlists/new" className="btn-secondary">New shortlist</Link>}
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Shortlists">
          {rows.map(({ shortlist, status }) => {
            const openAccesses = shortlist.accesses.filter((access) => !access.revokedAt);
            const answeredBy = new Map(shortlist.accesses.filter((access) => access.email).map((access) => [access.id, access.email!]));
            const lastViewed = openAccesses.reduce<Date | null>((latest, access) => (access.lastViewedAt && (!latest || access.lastViewedAt > latest) ? access.lastViewedAt : latest), null);
            const visible = shortlist.items.filter((item) => !item.person.doNotContact);
            const yes = visible.filter((item) => item.decision === "interview").length;
            return (
              <li key={shortlist.id} id={`shortlist-${shortlist.id}`}>
                <details className="shortlist-row" open={searchParams.open === shortlist.id}>
                  <summary>
                    <span className="min-w-0">
                      <span className="shortlist-row-title">{shortlist.title}</span>
                      <span className="shortlist-row-meta">
                        {shortlist.client} · <span className="tabular">{visible.length} {visible.length === 1 ? "person" : "people"}</span>
                        {yes > 0 && <> · <span className="tabular">{yes}</span> to meet</>}
                      </span>
                    </span>
                    <span className="shortlist-row-side">
                      <span className={`chip${status === "active" ? " screening-chip-done" : ""}`}>{STATUS_LABELS[status]}</span>
                      <span className="text-xs text-ink-soft">
                        {status === "active"
                          ? <>Open until {factDate.format(shortlist.expiresAt!)}</>
                          : status === "expired"
                            ? <>Expired {factDate.format(shortlist.expiresAt!)}</>
                            : <>Closed</>}
                      </span>
                      <Icon name="down" size={16} className="shortlist-row-chevron" />
                    </span>
                  </summary>

                  <div className="client-link-panel">
                    {status === "active" ? (
                      <ShortlistSharing shortlist={shortlist} accesses={openAccesses} active readOnly={readOnly} recruiterName={settings.recruiterName || owner.name} />
                    ) : status === "expired" ? (
                      <p>This shortlist expired, so its address shows {shortlist.client} that it is no longer active. Keep it open to make the same address work again.</p>
                    ) : (
                      <p>You closed this link. A new link brings the page back at a new address, with the same people on it.</p>
                    )}

                    <p className="client-link-stats">
                      <span>{lastViewed ? <>Last opened <strong>{formatWhen(lastViewed)}</strong></> : "Not opened yet"}</span>
                    </p>

                    <ul className="shortlist-people" aria-label={`People on ${shortlist.title}`}>
                      {shortlist.items.map((item) => (
                        <li key={item.id}>
                          <div className="min-w-0">
                            <Link href={`/people/${item.person.id}`} className="person-row-name">{item.person.fullName}</Link>
                            {item.person.headline && <p className="person-row-headline">{item.person.headline}</p>}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {item.person.doNotContact && <span className="chip person-flag">Do not contact, hidden from the client</span>}
                            {item.decision === "interview" && (
                              <span className="chip client-said-yes">
                                {shortlist.client} wants to meet{item.decisionAccessId && answeredBy.get(item.decisionAccessId) ? ` · ${answeredBy.get(item.decisionAccessId)}` : ""}
                              </span>
                            )}
                            {item.decision === "declined" && (
                              <span className="chip">
                                Not for {shortlist.client}
                                {item.decisionReason ? ` · ${DECISION_REASON_LABELS[item.decisionReason as keyof typeof DECISION_REASON_LABELS] ?? item.decisionReason}` : ""}
                                {item.decisionAccessId && answeredBy.get(item.decisionAccessId) ? ` · ${answeredBy.get(item.decisionAccessId)}` : ""}
                              </span>
                            )}
                            {item.decisionNote && <span className="client-said-note">&ldquo;{item.decisionNote}&rdquo;</span>}
                            <form action={removeFromShortlist}>
                              <input type="hidden" name="itemId" value={item.id} />
                              <ConfirmSubmitButton label="Remove" confirmText={`Take ${item.person.fullName} off this shortlist? ${shortlist.client} stops seeing them at once.`} />
                            </form>
                          </div>
                        </li>
                      ))}
                    </ul>

                    <div className="client-link-actions">
                      {status === "active" && !readOnly && <Link href={`/shortlists/new?add=${shortlist.id}`} className="btn-quiet">Add people</Link>}
                      <Link href={`/shortlists/${shortlist.id}/preview`} className="btn-quiet">See what {shortlist.client} sees</Link>
                      {status !== "revoked" && (
                        <ActionForm action={keepShortlistOpen} className="contents">
                          <input type="hidden" name="shortlistId" value={shortlist.id} />
                          <button type="submit" className="btn-quiet">Keep open 60 more days</button>
                        </ActionForm>
                      )}
                      <ActionForm action={newShortlistLink} className="contents">
                        <input type="hidden" name="shortlistId" value={shortlist.id} />
                        <ConfirmSubmitButton
                          label={status === "revoked" ? "Make a new link" : "Replace the link"}
                          confirmText={status === "revoked"
                            ? "Make a new link for this shortlist? The page opens again at a new address, with the same people on it."
                            : shortlist.access === "people"
                              ? "Give everyone a new link? Each person's current link stops working at once."
                              : "Replace this link? The address you sent stops working at once, and the page moves to a new address."}
                        />
                      </ActionForm>
                      {status === "active" && (
                        <form action={closeShortlist}>
                          <input type="hidden" name="shortlistId" value={shortlist.id} />
                          <ConfirmSubmitButton label="Close the link" confirmText={`Close this shortlist? ${shortlist.client} can no longer open the page. You can make a new link later.`} />
                        </form>
                      )}
                    </div>

                    <details>
                      <summary className="cursor-pointer text-sm text-ink-soft">Rename</summary>
                      {/* Only the name: everyone here agreed to be put forward to
                          this client, so the client is not something to edit. */}
                      <ActionForm action={renameShortlist} className="mt-3 flex flex-wrap items-end gap-3">
                        <input type="hidden" name="shortlistId" value={shortlist.id} />
                        <div className="min-w-0 flex-1">
                          <label htmlFor={`title-${shortlist.id}`} className="field-label">Name</label>
                          <input id={`title-${shortlist.id}`} name="title" defaultValue={shortlist.title} required maxLength={120} className="field-input" />
                        </div>
                        <button type="submit" className="btn-secondary">Save</button>
                      </ActionForm>
                    </details>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
