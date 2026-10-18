import Link from "next/link";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { listActivity, type ActivityEntry } from "@/lib/notifications";
import { releaseNotices, type ReleaseNotice } from "@/lib/release";
import { releaseIsNews } from "@/lib/onboarding";
import { canUseExtension } from "@/lib/extension-access";
import { MarkSeen } from "@/components/MarkSeen";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London" });
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

type Row = { kind: "activity"; entry: ActivityEntry } | { kind: "release"; notice: ReleaseNotice };
const atOf = (row: Row) => (row.kind === "activity" ? row.entry.at : row.notice.at).getTime();
const unreadOf = (row: Row) => (row.kind === "activity" ? row.entry.unread : row.notice.unread);

// What clients did on their links, the interviews candidates booked with them,
// and each new version of Capture, newest first. What has not been seen yet is
// marked; opening this page is what makes it seen, the current release
// included, once it is on screen, never a read-only view of it. The New marks
// stay until the page is next opened, so nothing moves under the reader.
export default async function NotificationsPage() {
  const { owner, readOnly } = await getWorkspace();
  const renderedAt = new Date();
  const [entries, currentIsNews, access] = await Promise.all([
    listActivity(owner.id),
    readOnly ? Promise.resolve(false) : releaseIsNews(owner),
    db.extensionAccess.findUnique({ where: { userId: owner.id }, select: { activatedAt: true } }),
  ]);
  const notices = await releaseNotices(owner.id, currentIsNews);
  // The download is the account's own; a read-only view cannot download.
  const canDownload = !readOnly && canUseExtension({ ...owner, extensionAccess: access });
  const rows: Row[] = [
    ...entries.map((entry) => ({ kind: "activity" as const, entry })),
    ...notices.map((notice) => ({ kind: "release" as const, notice })),
  ].sort((a, b) => atOf(b) - atOf(a));
  const fresh = rows.filter(unreadOf);
  const earlier = rows.filter((row) => !unreadOf(row));

  const activityItem = (entry: ActivityEntry) => <li key={entry.id} className="activity-item">
    <Link href={entry.href} className={`activity-entry activity-tone-${entry.tone}${entry.unread ? " is-unread" : ""}`} data-testid="activity-entry">
      <span className="activity-dot" aria-hidden="true" />
      <span className="activity-text">{entry.unread && <span className="sr-only">New: </span>}{entry.text}</span>
      <time className="activity-when" dateTime={entry.at.toISOString()}>{when.format(entry.at)}</time>
    </Link>
    {!readOnly && entry.arrange.length > 0 && <div className="activity-actions">
      {/* Arranging also puts them on the role's client link, so this is the one step. */}
      {entry.arrange.map((target) => <Link key={target.candidateId} href={`/candidates/${target.candidateId}/interview`} className="btn-quiet btn-arrange">
        {entry.arrange.length > 1 ? `Arrange interview · ${target.roleTitle}` : "Arrange interview"}
      </Link>)}
    </div>}
  </li>;

  // Only the current release has a What's new page and a download that is
  // still the right one; earlier releases keep their one line. The actions sit
  // in the text column, under what they act on.
  const releaseItem = ({ release, at, current, unread }: ReleaseNotice) => <li key={`release-${release.id}`} className="activity-item" data-testid="release-entry" data-release={release.id}>
    <div className={`activity-entry release-entry${unread ? " is-unread" : ""}`}>
      <span className="activity-dot" aria-hidden="true" />
      <div className="release-body">
        <span className="release-tag">Capture update</span>
        <p className="activity-text">{unread && <span className="sr-only">New: </span>}{release.title}</p>
        {current && release.extension && <p className="release-note">
          {canDownload
            ? <>This version needs a new copy of the browser extension. After you load it in <code className="font-mono">chrome://extensions</code>, generate a new capture key in <Link href="/settings" className="text-accent underline">Settings</Link> and paste it into the extension.</>
            : readOnly
              ? <>This version needs a new copy of the browser extension; it is downloaded from the account&rsquo;s own workspace.</>
              : <>This version needs a new copy of the browser extension. <Link href="/account" className="text-accent underline">Activate extension access</Link> to download it, then generate a new capture key in Settings.</>}
        </p>}
        {current && <div className="release-actions">
          {release.extension && canDownload && <a href="/api/extension/download" download className="btn-primary">Download the new extension<Icon name="down" size={15} /></a>}
          <Link href="/whats-new" className="release-link">See what&rsquo;s new<Icon name="arrow" size={14} /></Link>
        </div>}
      </div>
      <time className="activity-when" dateTime={at.toISOString()}>{day.format(at)}</time>
    </div>
  </li>;

  const list = (items: Row[]) => <ol className="activity-list">
    {items.map((row) => row.kind === "activity" ? activityItem(row.entry) : releaseItem(row.notice))}
  </ol>;

  return (
    <div className="min-w-0 max-w-3xl space-y-6">
      {!readOnly && fresh.length > 0 && <MarkSeen renderedAt={renderedAt.toISOString()} />}
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Workspace / Notifications</p>
          <h1>Notifications</h1>
        </div>
      </header>
      {!rows.length && <div className="card space-y-2">
        <p>Nothing yet.</p>
        <p className="text-sm text-ink-soft">When a client opens a link, answers about someone, sets their interview hours or can&rsquo;t make an interview, a candidate books one, or Capture gets a new version, it shows here and on the bell at the top.</p>
      </div>}
      {fresh.length > 0 && <section aria-label="New" className="space-y-2">
        <h2 className="section-heading">New <span className="unread-badge">{fresh.length}</span></h2>
        {!readOnly && <p className="text-sm text-ink-soft">Opening this page marks these as seen. They move to Earlier the next time you come here.</p>}
        {list(fresh)}
      </section>}
      {earlier.length > 0 && <section aria-label="Earlier" className="space-y-2">
        <h2 className="section-heading">{fresh.length ? "Earlier" : "Seen"}</h2>
        {list(earlier)}
      </section>}
    </div>
  );
}
