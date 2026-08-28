import Link from "next/link";
import { db } from "@/lib/db";
import { getFollowUpBuckets } from "@/lib/followups";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const [roles, buckets] = await Promise.all([
    db.role.findMany({
      where: { status: "open" },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { candidates: true } } },
    }),
    getFollowUpBuckets(),
  ]);

  const followUpsByRole = new Map<string, number>();
  for (const row of [
    ...buckets.repliedWaiting,
    ...buckets.saidYesNeverBooked,
    ...buckets.wentQuiet,
  ]) {
    followUpsByRole.set(row.roleId, (followUpsByRole.get(row.roleId) ?? 0) + 1);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-3xl">Roles</h1>
        <Link href="/roles/new" className="btn-primary">
          New role
        </Link>
      </div>

      {roles.length === 0 ? (
        <div className="card text-ink/70">
          <p>No open roles yet. Start by creating one.</p>
          <p className="mt-2">
            A role holds its briefing, its candidate list, and its saved searches, all in one
            place.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {roles.map((role) => {
            const followUps = followUpsByRole.get(role.id) ?? 0;
            return (
              <li key={role.id}>
                <Link href={`/roles/${role.id}`} className="card block hover:border-brass">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-display text-xl">{role.title}</span>
                    {role.client && <span className="text-ink/70">{role.client}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="chip">
                      {role._count.candidates}{" "}
                      {role._count.candidates === 1 ? "candidate" : "candidates"}
                    </span>
                    <span className="chip">
                      {followUps === 0
                        ? "no follow-ups today"
                        : `${followUps} to follow up today`}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
