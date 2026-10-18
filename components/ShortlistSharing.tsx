import { formatWhen } from "@/lib/dates";
import { shortlistLink } from "@/lib/shortlists";
import { addRecipients, removeRecipient, setShortlistAccess } from "@/app/actions/shortlist-access";
import { ActionForm } from "@/components/ActionForm";
import { ClientLinkShare } from "@/components/ClientLinkShare";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";

// Who can open a client link or shortlist, and how it is sent: one link for
// anyone who has it, or one link per named person, each opened by typing the
// email it was sent to. Shared by a role's client link and the shortlist
// library, so both work and read the same way.

type Access = { id: string; email: string | null; nonce: string; lastViewedAt: Date | null };

export function ShortlistSharing({ shortlist, accesses, active, readOnly, recruiterName }: {
  shortlist: { id: string; title: string; client: string | null; access: string; kind: string };
  // The accesses still open; revoked ones are left out by the caller.
  accesses: Access[];
  // Whether the page is open at all; when it is not, the caller says why.
  active: boolean;
  readOnly: boolean;
  recruiterName: string;
}) {
  const clientName = shortlist.client || "the client";
  const kind = shortlist.kind === "role" ? "role" : "custom";
  const named = accesses.filter((access) => access.email);
  const anyone = accesses.find((access) => !access.email) ?? null;
  const people = shortlist.access === "people";
  const linkFor = (access: Access) => (active && !readOnly ? shortlistLink(access.id, access.nonce) : null);
  const noLink = readOnly ? "Links are not shown in a read-only view." : "Client links need the server's shortlist link secret. Ask your administrator to set it.";

  return (
    <div className="shortlist-sharing">
      <div className="access-switch" role="group" aria-label="Who can open it">
        <form action={setShortlistAccess}>
          <input type="hidden" name="shortlistId" value={shortlist.id} />
          <input type="hidden" name="access" value="link" />
          {people ? (
            <ConfirmSubmitButton label="Anyone with the link" className="access-option" confirmText="Make this page open to anyone with its link? Every person's own link stops working, and there is one new link to send." />
          ) : (
            <button type="button" className="access-option" aria-pressed="true">Anyone with the link</button>
          )}
        </form>
        <form action={setShortlistAccess}>
          <input type="hidden" name="shortlistId" value={shortlist.id} />
          <input type="hidden" name="access" value="people" />
          {people ? (
            <button type="button" className="access-option" aria-pressed="true">Only these people</button>
          ) : (
            <ConfirmSubmitButton label="Only these people" className="access-option" confirmText="Share this page only with people you name? The link you have now stops working; each person gets their own." />
          )}
        </form>
      </div>

      {!people ? (
        active && (anyone && linkFor(anyone)
          ? <ClientLinkShare link={linkFor(anyone)!} roleTitle={shortlist.title} client={shortlist.client} recruiterName={recruiterName} kind={kind} />
          : <p>{noLink}</p>)
      ) : (
        <>
          <p>
            Each person gets their own link and opens it by typing the address it went to, once per browser.
            That stops a forwarded link opening for someone else; it does not prove who reads the inbox.
          </p>
          {named.length === 0 ? (
            <p className="text-ink-soft">No one yet. Add the people at {clientName} who should see it.</p>
          ) : (
            <ul className="recipient-list" aria-label="People it is shared with">
              {named.map((access) => {
                const link = linkFor(access);
                return (
                  <li key={access.id}>
                    <div className="recipient-head">
                      <strong className="recipient-email">{access.email}</strong>
                      <span className="text-xs text-ink-soft">{access.lastViewedAt ? `Opened ${formatWhen(access.lastViewedAt)}` : "Not opened yet"}</span>
                      <form action={removeRecipient} className="ml-auto">
                        <input type="hidden" name="accessId" value={access.id} />
                        <ConfirmSubmitButton label="Remove" confirmText={`Stop sharing with ${access.email}? Their link stops working at once.`} />
                      </form>
                    </div>
                    {active && (link
                      ? <ClientLinkShare link={link} roleTitle={shortlist.title} client={shortlist.client} recruiterName={recruiterName} kind={kind} to={access.email!} />
                      : <p className="text-sm text-ink-soft">{noLink}</p>)}
                  </li>
                );
              })}
            </ul>
          )}
          {/* Keyed by who is on it, so the box empties once they are added. */}
          <ActionForm key={named.map((access) => access.id).join(",")} action={addRecipients} className="recipient-add">
            <input type="hidden" name="shortlistId" value={shortlist.id} />
            <div className="min-w-0 flex-1">
              <label htmlFor={`recipients-${shortlist.id}`} className="field-label">Add people by email (one per line, or separated by commas)</label>
              <textarea id={`recipients-${shortlist.id}`} name="emails" rows={2} className="field-input" placeholder="hiring.manager@client.example" />
            </div>
            <button type="submit" className="btn-secondary">Add</button>
          </ActionForm>
        </>
      )}
    </div>
  );
}
