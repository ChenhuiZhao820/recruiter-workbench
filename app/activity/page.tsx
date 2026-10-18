import Link from "next/link";
import { getWorkspace } from "@/lib/workspace";
import { listActivity } from "@/lib/notifications";
import { MarkSeen } from "@/components/MarkSeen";

export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London" });

// What clients did on their links, and the interviews candidates booked with
// them, newest first. What has not been seen yet is marked; opening this page
// is what makes it seen, once it is on screen, never a read-only view of it.
export default async function ActivityPage() {
  const { owner, readOnly } = await getWorkspace();
  const renderedAt = new Date();
  const entries = await listActivity(owner.id);
  const fresh = entries.filter((entry) => entry.unread);
  const earlier = entries.filter((entry) => !entry.unread);

  const list = (rows: typeof entries) => <ol className="activity-list">
    {rows.map((entry) => <li key={entry.id}>
      <Link href={entry.href} className={`activity-entry activity-tone-${entry.tone}${entry.unread ? " is-unread" : ""}`} data-testid="activity-entry">
        <span className="activity-dot" aria-hidden="true" />
        <span className="activity-text">{entry.unread && <span className="sr-only">New: </span>}{entry.text}</span>
        <time className="activity-when" dateTime={entry.at.toISOString()}>{when.format(entry.at)}</time>
      </Link>
    </li>)}
  </ol>;

  return (
    <div className="min-w-0 max-w-3xl space-y-6">
      {!readOnly && fresh.length > 0 && <MarkSeen renderedAt={renderedAt.toISOString()} />}
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Workspace / Activity</p>
          <h1>Activity</h1>
          <p className="page-description">What your clients did on the links you sent them, and the interviews candidates booked with them.</p>
        </div>
      </header>
      {!entries.length && <div className="card space-y-2">
        <p>Nothing yet.</p>
        <p className="text-sm text-ink-soft">When a client opens a link, answers about someone, sets their interview hours or can&rsquo;t make an interview, or a candidate books one, it shows here and on the bell at the top.</p>
      </div>}
      {fresh.length > 0 && <section aria-label="New" className="space-y-2">
        <h2 className="section-heading">New <span className="unread-badge">{fresh.length}</span></h2>
        {list(fresh)}
      </section>}
      {earlier.length > 0 && <section aria-label="Earlier" className="space-y-2">
        <h2 className="section-heading">{fresh.length ? "Earlier" : "Seen"}</h2>
        {list(earlier)}
      </section>}
    </div>
  );
}
