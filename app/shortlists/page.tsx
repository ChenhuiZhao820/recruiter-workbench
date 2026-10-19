import Link from "next/link";
import { db } from "@/lib/db";
import { requireFeature } from "@/lib/feature-access";
import { activeShortlistLimit } from "@/lib/features";
import { getSettings } from "@/lib/settings";
import { formatWhen } from "@/lib/dates";
import { factDate } from "@/lib/fact-labels";
import { DECISION_REASON_LABELS, shortlistStatus } from "@/lib/shortlist-core.mjs";
import { closeShortlist, deleteShortlists, keepShortlistOpen, newShortlistLink, removeFromShortlist, renameShortlist } from "@/app/actions/custom-shortlists";
import { BulkDeleteShortlists } from "@/components/BulkDeleteShortlists";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { ShortlistSharing } from "@/components/ShortlistSharing";
import { Icon } from "@/components/Icon";
import { unreadShortlists } from "@/lib/notifications";
import { MarkSeen } from "@/components/MarkSeen";

export const dynamic = "force-dynamic";

// A library, like Templates: each shortlist is one collapsed row with its
// name, client and state, opened to share it, see who is on it and what the
// client said, or close it. Making a new one starts from People (New
// shortlist there, or a person's page or a role), never from here.
// Closed and expired ones sit in their own group below, where they can be
// reopened (within the plan's limit, shown before the button is pressed) or
// deleted, one at a time or ticked together.

const STATUS_LABELS: Record<string, string> = { active: "Open", expired: "Expired", revoked: "Closed", closed: "Closed" };
const BULK_FORM = "delete-shortlists";

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
        include: { person: { select: { id: true, fullName: true, headline: true, doNotContact: true, cv: { select: { uploadedAt: true } } } } },
      },
    },
  });
  const rows = shortlists.map((shortlist) => ({ shortlist, status: shortlistStatus(shortlist, null, now) }));
  const open = rows.filter((row) => row.status === "active");
  // Most recently closed or expired first.
  const inactive = rows
    .filter((row) => row.status !== "active")
    .sort((a, b) => (b.shortlist.revokedAt ?? b.shortlist.expiresAt ?? b.shortlist.createdAt).getTime() - (a.shortlist.revokedAt ?? a.shortlist.expiresAt ?? a.shortlist.createdAt).getTime());
  const active = open.length;
  const limit = activeShortlistLimit(owner, now);
  const atLimit = limit !== null && active >= limit;
  const unread = await unreadShortlists(owner.id);
  const anyUnread = shortlists.some((shortlist) => unread.has(shortlist.id));

  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-8">
      {!readOnly && anyUnread && <MarkSeen renderedAt={now.toISOString()} scope="shortlists" />}
      <header className="page-header">
        <div>
          <h1>Shortlists</h1>
          <p className="page-description">
            The pages you made for clients, to open without signing in. Share, reopen or tidy them here; start a new one from <Link href="/people" className="underline">People</Link>.
          </p>
        </div>
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
          <p>Start one from People with New shortlist, or from a person&rsquo;s page.</p>
          {!readOnly && <Link href="/people" className="btn-secondary">Go to People</Link>}
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <section aria-labelledby="open-heading" className="space-y-3">
              {inactive.length > 0 && <h2 id="open-heading" className="shortlist-group-title">Open <span className="tabular">{open.length}</span></h2>}
              <ul className="space-y-3" aria-label="Open shortlists">
                {open.map((row) => <li key={row.shortlist.id} id={`shortlist-${row.shortlist.id}`}>{renderRow(row)}</li>)}
              </ul>
            </section>
          )}
          {inactive.length > 0 && (
            <section aria-labelledby="inactive-heading" className="space-y-3">
              <div className="shortlist-group-head">
                <div>
                  <h2 id="inactive-heading" className="shortlist-group-title">Closed and expired <span className="tabular">{inactive.length}</span></h2>
                  <p className="text-sm text-ink-soft">Clients can&rsquo;t open these. Reopen one to share it again, or delete what you no longer need.</p>
                </div>
                {!readOnly && <BulkDeleteShortlists formId={BULK_FORM} />}
              </div>
              <ul className="space-y-3" aria-label="Closed and expired shortlists">
                {inactive.map((row) => (
                  <li key={row.shortlist.id} id={`shortlist-${row.shortlist.id}`} className="shortlist-select-row">
                    {!readOnly && <input type="checkbox" form={BULK_FORM} name="id" value={row.shortlist.id} className="shortlist-check" aria-label={`Select ${row.shortlist.title}`} />}
                    {renderRow(row)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </fieldset>
  );

  function renderRow({ shortlist, status }: (typeof rows)[number]) {
    const openAccesses = shortlist.accesses.filter((access) => !access.revokedAt);
    const answeredBy = new Map(shortlist.accesses.filter((access) => access.email).map((access) => [access.id, access.email!]));
    const lastViewed = openAccesses.reduce<Date | null>((latest, access) => (access.lastViewedAt && (!latest || access.lastViewedAt > latest) ? access.lastViewedAt : latest), null);
    const visible = shortlist.items.filter((item) => !item.person.doNotContact);
    const yes = visible.filter((item) => item.decision === "interview").length;
    const inactiveRow = status !== "active";
    return (
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
            {unread.has(shortlist.id) && <span className="new-chip">New</span>}
            <span className={`chip${status === "active" ? " screening-chip-done" : ""}`}>{STATUS_LABELS[status]}</span>
            <span className="text-xs text-ink-soft">
              {status === "active"
                ? <>Until {factDate.format(shortlist.expiresAt!)}</>
                : status === "expired"
                  ? <>{factDate.format(shortlist.expiresAt!)}</>
                  : <>{factDate.format(shortlist.revokedAt!)}</>}
            </span>
            <Icon name="down" size={16} className="shortlist-row-chevron" />
          </span>
        </summary>

        <div className="client-link-panel">
          {status === "active" ? (
            <ShortlistSharing shortlist={shortlist} accesses={openAccesses} active readOnly={readOnly} recruiterName={settings.recruiterName || owner.name} />
          ) : status === "expired" ? (
            <p>Expired on {factDate.format(shortlist.expiresAt!)}, so {shortlist.client} can&rsquo;t open it. Reopening makes the same address work again for 60 days.</p>
          ) : (
            <p>You closed this on {factDate.format(shortlist.revokedAt!)}, so {shortlist.client} can&rsquo;t open it. Reopening gives it a new address with the same people; the old link stays closed.</p>
          )}

          {inactiveRow && !readOnly && (
            <div className="shortlist-reopen">
              {atLimit ? (
                <>
                  <button type="button" className="btn-secondary" disabled aria-describedby={`reopen-${shortlist.id}`}>Reopen</button>
                  <p id={`reopen-${shortlist.id}`} className="shortlist-reopen-note">
                    <strong className="tabular">{active} of {limit}</strong> open on your plan. Close an open shortlist to reopen this one.
                  </p>
                </>
              ) : (
                <ActionForm action={status === "expired" ? keepShortlistOpen : newShortlistLink} className="contents">
                  <input type="hidden" name="shortlistId" value={shortlist.id} />
                  <button type="submit" className="btn-secondary">Reopen</button>
                </ActionForm>
              )}
            </div>
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
                  {!item.person.doNotContact && !item.person.cv && status === "active" && <Link href={`/people/${item.person.id}#cv-heading`} className="chip no-cv-chip">No CV · Upload</Link>}
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
            {status === "active" && (
              <>
                <ActionForm action={keepShortlistOpen} className="contents">
                  <input type="hidden" name="shortlistId" value={shortlist.id} />
                  <button type="submit" className="btn-quiet">Keep open 60 more days</button>
                </ActionForm>
                <ActionForm action={newShortlistLink} className="contents">
                  <input type="hidden" name="shortlistId" value={shortlist.id} />
                  <ConfirmSubmitButton
                    label="Replace the link"
                    confirmText={shortlist.access === "people"
                      ? "Give everyone a new link? Each person's current link stops working at once."
                      : "Replace this link? The address you sent stops working at once, and the page moves to a new address."}
                  />
                </ActionForm>
                <form action={closeShortlist}>
                  <input type="hidden" name="shortlistId" value={shortlist.id} />
                  <ConfirmSubmitButton label="Close the link" confirmText={`Close this shortlist? ${shortlist.client} can no longer open the page. You can reopen it later.`} />
                </form>
              </>
            )}
            {inactiveRow && (
              <ActionForm action={deleteShortlists} className="contents">
                <input type="hidden" name="id" value={shortlist.id} />
                <ConfirmSubmitButton
                  label="Delete"
                  className="btn-quiet btn-danger-quiet"
                  confirmText={`Delete "${shortlist.title}" for good? Its link and ${shortlist.client}'s answers on it are removed. The people stay in People.`}
                />
              </ActionForm>
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
    );
  }
}
