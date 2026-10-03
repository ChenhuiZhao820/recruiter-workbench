import Link from "next/link";
import { db } from "@/lib/db";
import { requireFeature } from "@/lib/feature-access";
import { formatWhen } from "@/lib/dates";
import { keepPerson } from "@/app/actions/talent";
import { Icon } from "@/components/Icon";
import { REVIEW_MONTHS, reviewCutoff } from "@/lib/talent.mjs";

export const dynamic = "force-dynamic";

// UK GDPR asks that personal data is not kept longer than needed. This is the
// list of people nothing has happened with for a year: keep each for another
// year if there is a reason, or open them to erase. Erasing stays on the
// person page, behind its typed confirmation.
export default async function ReviewPage() {
  const { owner, readOnly } = await requireFeature("privacy");
  const cutoff = reviewCutoff();
  const people = await db.person.findMany({
    where: {
      userId: owner.id,
      updatedAt: { lt: cutoff },
      OR: [{ lastContactAt: null }, { lastContactAt: { lt: cutoff } }],
      candidates: { none: { lastActivityAt: { gte: cutoff } } },
    },
    orderBy: { updatedAt: "asc" },
    take: 500,
    select: {
      id: true, fullName: true, headline: true, updatedAt: true, lastContactAt: true, emailConsentAt: true,
      candidates: { orderBy: { lastActivityAt: "desc" }, take: 1, select: { lastActivityAt: true, role: { select: { title: true } } } },
    },
  });

  return (
    <fieldset disabled={readOnly} className="min-w-0">
      <header className="page-header">
        <div>
          <p className="page-eyebrow"><Link href="/people" className="hover:text-ink">People</Link> / Review</p>
          <h1>Review old records</h1>
          <p className="page-description">
            People with no activity for {REVIEW_MONTHS} months. Keep anyone you still have a reason to hold on to, and erase the rest from their page.
          </p>
        </div>
      </header>

      {people.length === 0 ? (
        <div className="card empty-state">
          <span className="empty-state-icon"><Icon name="people" size={26} /></span>
          <h3>Nothing to review</h3>
          <p>Everyone in your database has had some activity in the last {REVIEW_MONTHS} months.</p>
          <Link href="/people" className="btn-secondary">Back to people</Link>
        </div>
      ) : (
        <ul className="people-list" aria-label="People to review">
          {people.map((person) => {
            const latest = person.candidates[0];
            const last = [person.updatedAt, person.lastContactAt, latest?.lastActivityAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0]!;
            return (
              <li key={person.id} className="match-row">
                <div className="min-w-0">
                  <Link href={`/people/${person.id}`} className="person-row-name">{person.fullName}</Link>
                  {person.headline && <p className="person-row-headline">{person.headline}</p>}
                  <p className="person-row-facts">
                    <span className="tabular">Last activity {formatWhen(last)}</span>
                    {latest && <span className="text-ink-soft">{latest.role.title}</span>}
                    {person.emailConsentAt && <span className="chip">Agreed to be kept</span>}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <form action={keepPerson}>
                    <input type="hidden" name="personId" value={person.id} />
                    <button type="submit" className="btn-quiet">Keep for another year</button>
                  </form>
                  <Link href={`/people/${person.id}`} className="btn-quiet">Open to erase</Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
