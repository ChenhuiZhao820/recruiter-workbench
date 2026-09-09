import Link from "next/link";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { getFollowUpBuckets } from "@/lib/followups";
import { MarketingHome } from "@/components/MarketingHome";
import { RoleDirectory } from "@/components/RoleDirectory";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  if (!await getSession()) return <MarketingHome />;
  const { owner, readOnly } = await getWorkspace();
  const [roles, closedRoles, buckets, searchCount] = await Promise.all([
    db.role.findMany({
      where: { userId: owner.id, status: "open" },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { candidates: true } } },
    }),
    // Closed roles stay off the main list but must remain reachable.
    db.role.findMany({
      where: { userId: owner.id, status: "closed" },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { candidates: true } } },
    }),
    getFollowUpBuckets(),
    db.savedSearch.count({ where: { userId: owner.id, OR: [{ roleId: null }, { role: { userId: owner.id } }] } }),
  ]);

  const followUpsByRole = new Map<string, number>();
  const followUps = [...buckets.repliedWaiting, ...buckets.saidYesNeverBooked, ...buckets.wentQuiet];
  for (const row of followUps) followUpsByRole.set(row.roleId, (followUpsByRole.get(row.roleId) ?? 0) + 1);
  const summarize = (role: typeof roles[number]) => ({
    id: role.id, title: role.title, client: role.client,
    candidateCount: role._count.candidates,
    followUps: followUpsByRole.get(role.id) ?? 0,
    updatedAt: role.updatedAt.toISOString(),
  });
  const metrics = [
    { label: "Open roles", value: roles.length, caption: "Active searches", icon: "roles" },
    { label: "People in pipeline", value: roles.reduce((count, role) => count + role._count.candidates, 0), caption: "Across your open roles", icon: "people" },
    { label: "Follow-ups today", value: followUps.length, caption: "Conversations to move forward", icon: "clock" },
    { label: "Saved searches", value: searchCount, caption: "Ready when you are", icon: "search" },
  ] as const;

  return <div className="dashboard-page">
    <header className="page-header"><div><p className="page-eyebrow">Your recruiting workspace</p><h1>Roles</h1><p className="page-description">A clearer view of the people and conversations that matter.</p></div>{!readOnly && <Link href="/roles/new" className="btn-primary"><Icon name="plus" size={18} />New role</Link>}</header>
    <div className="dashboard-metrics">{metrics.map((metric) => <div key={metric.label} className="metric-card"><div><span>{metric.label}</span><Icon name={metric.icon} size={18} /></div><strong className={metric.label === "Follow-ups today" && metric.value ? "text-accent" : ""}>{String(metric.value).padStart(2, "0")}</strong><small>{metric.caption}</small></div>)}</div>
    <div className="dashboard-grid">
      <RoleDirectory roles={roles.map(summarize)} closedRoles={closedRoles.map(summarize)} readOnly={readOnly} />
      <aside className="dashboard-aside">
        <section className="focus-panel"><div className="focus-heading"><span className="focus-icon"><Icon name="clock" size={19} /></span><h2>Your next moves</h2></div><p>A little attention goes a long way.</p>{followUps.length ? <ul className="focus-list">{followUps.slice(0, 3).map((row) => <li key={row.candidateId}><Link href={`/candidates/${row.candidateId}/outreach`}><span className="focus-person">{row.candidateName}<Icon name="external" size={14} /></span><span>{row.roleTitle}</span><small>{row.lastEvent}</small></Link></li>)}</ul> : <div className="focus-clear"><span><Icon name="check" size={24} /></span><strong>You’re all caught up.</strong><p>Your next follow-ups will appear here.</p></div>}<Link href="/followups" className="focus-link">Open follow-ups<Icon name="arrow" size={16} /></Link></section>
        <section className="workspace-tip"><Icon name="spark" size={18} /><h2>Keep the useful details.</h2><p>Your note is what turns a saved profile into a considered shortlist. Capture what caught your attention while it’s fresh.</p><span className="eyebrow">GOOD CONTEXT. BETTER CONVERSATIONS.</span></section>
      </aside>
    </div>
  </div>;
}
