import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireFeature, featureAvailability } from "@/lib/feature-access";
import { formatWhen } from "@/lib/dates";
import { profileHref } from "@/lib/urls";
import { templateKindLabel } from "@/lib/templates";
import { StageBadge } from "@/components/StageBadge";
import { Icon } from "@/components/Icon";
import { deletePerson, setDoNotContact } from "@/app/actions/people";

export const dynamic = "force-dynamic";

const REMOTE_LABELS: Record<string, string> = {
  onsite: "On site",
  hybrid: "Hybrid",
  remote: "Remote",
  flexible: "Flexible",
};
const RIGHT_TO_WORK_LABELS: Record<string, string> = {
  has_right: "Has the right to work",
  needs_sponsorship: "Needs sponsorship",
  unknown: "Not known",
};

function money(value: number, currency: string | null) {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP", maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${value.toLocaleString("en-GB")} ${currency ?? ""}`.trim();
  }
}

function salaryText(min: number | null, max: number | null, currency: string | null) {
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min !== max) return `${money(min, currency)} to ${money(max, currency)} a year`;
  return `${money((min ?? max)!, currency)} a year`;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function PersonPage({ params }: { params: { id: string } }) {
  const { owner, readOnly } = await requireFeature("people");
  const features = await featureAvailability();
  const person = await db.person.findFirst({
    where: { id: params.id, userId: owner.id },
    include: {
      candidates: {
        where: { role: { userId: owner.id } },
        orderBy: { lastActivityAt: "desc" },
        include: {
          role: { select: { id: true, title: true, client: true, status: true } },
          outreach: { orderBy: { sentAt: "desc" } },
        },
      },
    },
  });
  if (!person) notFound();

  const profile = profileHref(person.profileUrl);
  const messages = person.candidates
    .flatMap((candidate) => candidate.outreach.map((log) => ({ ...log, roleTitle: candidate.role.title })))
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());

  const salary = salaryText(person.salaryMin, person.salaryMax, person.salaryCurrency);
  const location = [person.location, person.remotePreference ? REMOTE_LABELS[person.remotePreference] ?? person.remotePreference : null]
    .filter(Boolean)
    .join(", ");
  const facts = [
    { label: "Salary expectation", value: salary, note: person.salaryNote },
    { label: "Notice period", value: person.noticeWeeks !== null ? `${person.noticeWeeks} ${person.noticeWeeks === 1 ? "week" : "weeks"}` : null, note: person.availableFrom ? `Available from ${dateFormat.format(person.availableFrom)}` : null },
    { label: "Location and remote", value: location || null, note: null },
    { label: "Right to work", value: person.rightToWork ? RIGHT_TO_WORK_LABELS[person.rightToWork] ?? person.rightToWork : null, note: person.rightToWorkNote },
  ];
  const hasFacts = facts.some((fact) => fact.value);

  return (
    <fieldset key={person.id} disabled={readOnly} className="min-w-0">
      <header className="page-header">
        <div>
          <p className="page-eyebrow"><Link href="/people" className="hover:text-ink">People</Link> / Person</p>
          <h1>{person.fullName}</h1>
          {person.headline && <p className="page-description">{person.headline}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {person.doNotContact && <span className="chip person-flag">Do not contact</span>}
          {profile && (
            <a
              href={readOnly ? undefined : profile}
              aria-disabled={readOnly}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              Open profile<Icon name="external" size={16} />
            </a>
          )}
        </div>
      </header>

      <div className="person-layout">
        <div className="min-w-0 space-y-10">
          {/* Facts come from confirmed screenings. Without that feature and with
              nothing recorded, the section is omitted rather than shown empty. */}
          {(hasFacts || features.screening) && <section aria-labelledby="facts-heading" className="space-y-4">
            <div>
              <h2 id="facts-heading" className="section-heading">What they told you</h2>
              <p className="section-caption">
                {hasFacts && person.factsConfirmedAt
                  ? `Their own statements, confirmed by you on ${dateFormat.format(person.factsConfirmedAt)}. Not verified.`
                  : "Filled in when you confirm a screening call. Their own statements, not verified."}
              </p>
            </div>
            <dl className="fact-grid">
              {facts.map((fact) => (
                <div key={fact.label} className="fact">
                  <dt>{fact.label}</dt>
                  <dd className={fact.value ? "" : "fact-empty"}>{fact.value ?? "Not recorded"}</dd>
                  {fact.value && fact.note && <dd className="fact-note">{fact.note}</dd>}
                </div>
              ))}
            </dl>
          </section>}

          <section aria-labelledby="roles-heading" className="space-y-4">
            <div>
              <h2 id="roles-heading" className="section-heading">Roles <span className="person-count tabular">{person.candidates.length}</span></h2>
              <p className="section-caption">Every role you considered them for, most recent first.</p>
            </div>
            {person.candidates.length === 0 ? (
              <p className="text-sm text-ink-soft">Not on any role. Add them to a role from that role&rsquo;s page.</p>
            ) : (
              <ul className="people-list">
                {person.candidates.map((candidate) => (
                  <li key={candidate.id} className="person-role-row">
                    <div className="min-w-0">
                      <Link href={`/roles/${candidate.role.id}`} className="person-row-name">{candidate.role.title}</Link>
                      <p className="person-row-headline">
                        {candidate.role.client || "Independent search"}
                        {candidate.role.status === "closed" ? " (closed)" : ""}
                      </p>
                    </div>
                    <StageBadge stage={candidate.stage} />
                    <p className="person-row-when tabular">Last activity {formatWhen(candidate.lastActivityAt)}</p>
                    {candidate.role.status === "open" && !person.doNotContact && (
                      <Link href={`/candidates/${candidate.id}/outreach`} className="btn-quiet">Write a message</Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="messages-heading" className="space-y-4">
            <div>
              <h2 id="messages-heading" className="section-heading">Messages sent <span className="person-count tabular">{messages.length}</span></h2>
              <p className="section-caption">What you recorded as sent, from any role.</p>
            </div>
            {messages.length === 0 ? (
              <p className="text-sm text-ink-soft">No messages recorded yet.</p>
            ) : (
              <ol className="message-log">
                {messages.map((message) => (
                  <li key={message.id}>
                    <details>
                      <summary>
                        <span className="tabular">{dateFormat.format(message.sentAt)}</span>
                        <span>{templateKindLabel(message.kind)}</span>
                        <span className="text-ink-soft">{message.roleTitle}</span>
                      </summary>
                      <p className="message-body">{message.renderedBody}</p>
                    </details>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        {features.privacy && !readOnly && (
          <aside aria-labelledby="privacy-heading" className="person-aside">
            <h2 id="privacy-heading" className="text-base font-semibold">Contact and privacy</h2>

            <form action={setDoNotContact} className="space-y-2">
              <input type="hidden" name="id" value={person.id} />
              <input type="hidden" name="value" value={person.doNotContact ? "false" : "true"} />
              <p className="text-sm text-ink-soft">
                {person.doNotContact
                  ? "Marked do not contact. Booking links stop working and they are left out of matches."
                  : "If they ask not to be contacted, mark them here. Their record stays, and nothing new goes out."}
              </p>
              <button type="submit" className="btn-secondary w-full">
                {person.doNotContact ? "Allow contact again" : "Mark do not contact"}
              </button>
            </form>

            <form action={deletePerson} className="space-y-3 border-t border-line pt-5">
              <input type="hidden" name="id" value={person.id} />
              <p className="text-sm text-ink-soft">
                Erasing removes this person, every role they are on, and the messages and calls recorded for them. It cannot be undone.
              </p>
              <div>
                <label htmlFor="erase-confirm" className="field-label">Type DELETE to confirm</label>
                <input id="erase-confirm" name="confirm" required pattern="DELETE" autoComplete="off" className="field-input" />
              </div>
              <button type="submit" className="btn-destructive w-full">Erase this person</button>
            </form>
          </aside>
        )}
      </div>
    </fieldset>
  );
}
