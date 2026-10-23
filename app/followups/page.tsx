import Link from "next/link";
import { getFollowUpBuckets, type FollowUpRow } from "@/lib/followups";
import { getSettings } from "@/lib/settings";
import { getWorkspace } from "@/lib/workspace";
import { formatWhen } from "@/lib/dates";
import { templateKindLabel } from "@/lib/templates";
import { profileHref } from "@/lib/urls";
import { setCandidateStage } from "@/app/actions/candidates";
import { db } from "@/lib/db";
import { featureAvailability } from "@/lib/feature-access";
import { setRevisit } from "@/app/actions/talent";
import { ActionForm } from "@/components/ActionForm";
import { REVISIT_SOON_DAYS } from "@/lib/talent.mjs";
import { factDate } from "@/lib/fact-labels";
import { ResumeRun } from "@/components/FollowUpRun";
import { clientKey } from "@/lib/shortlist-core.mjs";
import { RoleTabs } from "@/components/RoleTabs";

export const dynamic = "force-dynamic";

function QuickStageButton({
  candidateId,
  stage,
  label,
}: {
  candidateId: string;
  stage: string;
  label: string;
}) {
  return (
    <form action={setCandidateStage}>
      <input type="hidden" name="id" value={candidateId} />
      <input type="hidden" name="stage" value={stage} />
      <button type="submit" className="btn-quiet">
        {label}
      </button>
    </form>
  );
}

function Bucket({
  title,
  description,
  rows,
  actions,
  readOnly,
  run,
}: {
  title: string;
  description: string;
  rows: FollowUpRow[];
  readOnly: boolean;
  actions: (row: FollowUpRow) => React.ReactNode;
  // The follow-up run for just this group, when it has anyone in it.
  run?: string;
}) {
  return (
    <section aria-label={title} className="workspace-section">
      <div className="role-panel-head">
        <h2 className="sr-only">{title}</h2>
        <p className="section-caption">{description}</p>
        {run && rows.length > 0 && (
          <Link href={run} className="btn-quiet">Go through these one by one</Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-ink/60">Nothing here. All clear.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.candidateId} className="card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{row.candidateName}</span>
                <span className="text-sm text-ink/60">
                  <Link href={`/roles/${row.roleId}`} className="underline">
                    {row.roleTitle}
                  </Link>
                </span>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink/80">
                <span>
                  {row.lastEvent} · {formatWhen(row.lastEventAt)}
                </span>
                {row.lastOutreachKind && (
                  <span className="chip">via {templateKindLabel(row.lastOutreachKind)}</span>
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {profileHref(row.profileUrl) && (
                  <a
                    href={readOnly ? undefined : profileHref(row.profileUrl)!}
                    aria-disabled={readOnly}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-quiet"
                  >
                    Open profile
                  </a>
                )}
                {actions(row)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function FollowUpsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const { owner, readOnly } = await getWorkspace();
  const now = new Date();
  const features = await featureAvailability();
  const [buckets, settings, calls, revisits] = await Promise.all([
    getFollowUpBuckets(),
    getSettings(),
    // Calls candidates booked through the booking page, for the coming week.
    db.booking.findMany({
      where: { userId: owner.id, status: "booked", endsAt: { gt: now }, startsAt: { lt: new Date(now.getTime() + 7 * 86_400_000) }, candidate: { role: { userId: owner.id } } },
      orderBy: { startsAt: "asc" },
      select: { id: true, startsAt: true, mode: true, phone: true, kind: true, candidate: { select: { id: true, fullName: true, role: { select: { id: true, title: true, client: true } } } } },
    }),
    // People the recruiter chose to come back to, due within the week or overdue.
    features.revisitReminders
      ? db.person.findMany({
          where: { userId: owner.id, doNotContact: false, revisitOn: { lte: new Date(now.getTime() + REVISIT_SOON_DAYS * 86_400_000) } },
          orderBy: { revisitOn: "asc" },
          take: 100,
          select: { id: true, fullName: true, headline: true, revisitOn: true, revisitNote: true },
        })
      : Promise.resolve([]),
  ]);
  // Interview answers on custom shortlists. A custom shortlist is not a role,
  // so these are not in the run; each points at the role for the same client
  // where the answer can be brought across, or says there is none yet.
  const shortlistAnswers = features.clientShortlists
    ? (await db.shortlistItem.findMany({
        where: { decision: "interview", shortlist: { userId: owner.id, kind: "custom" }, person: { doNotContact: false } },
        orderBy: { decisionAt: "desc" },
        take: 50,
        select: {
          id: true,
          decisionAt: true,
          shortlist: { select: { id: true, title: true, client: true } },
          person: {
            select: {
              id: true,
              fullName: true,
              headline: true,
              candidates: {
                where: { role: { status: "open" }, stage: { notIn: ["rejected", "placed"] } },
                select: { id: true, role: { select: { id: true, title: true, client: true, shortlist: { select: { items: { select: { personId: true, decision: true, decisionAt: true } } } } } } },
              },
            },
          },
        },
      }))
        .map((answer) => {
          const key = clientKey(answer.shortlist.client, "");
          const roles = answer.person.candidates.filter((candidate) => clientKey(candidate.role.client, candidate.role.id) === key);
          // Already brought across: the role's own link holds this answer or a later one.
          const settled = roles.some((candidate) => candidate.role.shortlist?.items.some((item) => item.personId === answer.person.id && item.decision && item.decisionAt && answer.decisionAt && item.decisionAt >= answer.decisionAt));
          return settled ? null : { ...answer, roles };
        })
        .filter((answer): answer is NonNullable<typeof answer> => answer !== null)
    : [];
  const due = features.followUpRuns ? buckets.repliedWaiting.length + buckets.clientWantsToMeet.length + buckets.saidYesNeverBooked.length + buckets.wentQuiet.length : 0;
  const callTime = new Intl.DateTimeFormat("en-GB", { timeZone: settings.bookingTimezone, weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  // Open on what was asked for, else the first group that has someone in it.
  const groups: [string, number][] = [["replied", buckets.repliedWaiting.length], ["client", buckets.clientWantsToMeet.length + shortlistAnswers.length], ["booking", buckets.saidYesNeverBooked.length], ["quiet", buckets.wentQuiet.length], ["revisit", features.revisitReminders ? revisits.length : 0]];
  const asked = groups.find(([id, count]) => id === searchParams.tab && (count > 0 || id === "replied" || id === "booking" || id === "quiet" || id === "revisit"))?.[0];
  const initialTab = asked ?? groups.find(([, count]) => count > 0)?.[0] ?? "replied";

  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-8">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Pipeline / Next steps</p>
          <h1>Follow-ups today</h1>
          <p className="page-description">Keep the conversation moving. Built from your own notes and timestamps.</p>
        </div>
        {due > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <ResumeRun />
            {/* The whole list, ticked with reasons, to change before starting. */}
            <Link href="/followups/run" className="btn-primary">Follow up in batches ({due})</Link>
          </div>
        )}
      </header>

      {calls.length > 0 && (
        <section aria-labelledby="calls-heading" className="workspace-section">
          <h2 id="calls-heading" className="section-heading">Calls this week</h2>
          <p className="section-caption mb-4">Booked by candidates through your booking page, and client interviews they booked.</p>
          <ul className="space-y-2">
            {calls.map((call) => (
              <li key={call.id} className="card flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className="font-medium tabular">{callTime.format(call.startsAt)}</span>{" "}
                  <span>{call.candidate.fullName}</span>
                  <span className="text-ink-soft">
                    {call.kind === "interview" ? `, interview with ${call.candidate.role.client || "the client"}` : call.mode === "phone" ? `, phone ${call.phone}` : ", video"}
                  </span>
                </span>
                <Link href={`/roles/${call.candidate.role.id}`} className="text-sm text-ink/60 underline">{call.candidate.role.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RoleTabs
        key="followups"
        home="replied"
        label="Follow-ups"
        initial={initialTab}
        tabs={[
          { id: "replied", label: "Replied", count: buckets.repliedWaiting.length, panel: (
            <Bucket
              readOnly={readOnly}
              title="Replied, waiting on you"
              description="They answered and you have not responded yet."
              rows={buckets.repliedWaiting}
              run={features.followUpRuns ? "/followups/run?only=r" : undefined}
              actions={(row) => (
                <>
                  <Link href={`/candidates/${row.candidateId}/outreach`} className="btn-quiet">
                    Draft reply
                  </Link>
                  <QuickStageButton candidateId={row.candidateId} stage="booking_pending" label="They said yes" />
                  <QuickStageButton candidateId={row.candidateId} stage="rejected" label="Mark rejected" />
                </>
              )}
            />
          ) },
          // Only when a client has answered: most weeks it is empty.
          ...(buckets.clientWantsToMeet.length > 0 || shortlistAnswers.length > 0 ? [{ id: "client", label: "Client wants to meet", count: buckets.clientWantsToMeet.length + shortlistAnswers.length, panel: (
            <>
              {buckets.clientWantsToMeet.length > 0 && (
                <Bucket
                  readOnly={readOnly}
                  title="Client wants to meet"
                  description="A client pressed Interview on your client link. Set the time, or offer a few, and let the candidate know."
                  rows={buckets.clientWantsToMeet}
                  run={features.followUpRuns ? "/followups/run?only=m" : undefined}
                  actions={(row) => (
                    <>
                      <Link href={`/candidates/${row.candidateId}/interview`} className="btn-quiet btn-arrange">
                        Arrange interview
                      </Link>
                      <QuickStageButton candidateId={row.candidateId} stage="rejected" label="Mark rejected" />
                    </>
                  )}
                />
              )}
              {shortlistAnswers.length > 0 && (
                <section aria-label="Wants to meet, from a shortlist" className="workspace-section">
                  <h2 className="sr-only">Wants to meet, from a shortlist</h2>
                  <p className="section-caption role-panel-head">A client pressed Interview on a shortlist you sent. Arranging the interview also puts them on the role&rsquo;s client link.</p>
                  <ul className="space-y-2">
                    {shortlistAnswers.map((answer) => (
                      <li key={answer.id} className="card flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0">
                          <Link href={`/people/${answer.person.id}`} className="person-row-name">{answer.person.fullName}</Link>
                          <span className="text-ink-soft"> · {answer.shortlist.client} wants to meet · {answer.shortlist.title}</span>
                        </span>
                        <span className="flex flex-wrap items-center gap-2">
                          {answer.roles.length > 0
                            ? answer.roles.map((candidate) => (
                                <Link key={candidate.id} href={`/candidates/${candidate.id}/interview`} className="btn-quiet btn-arrange">{answer.roles.length > 1 ? `Arrange interview · ${candidate.role.title}` : "Arrange interview"}</Link>
                              ))
                            : <>
                                <span className="text-sm text-ink-soft">Not on an open role for {answer.shortlist.client}</span>
                                <Link href={`/people/${answer.person.id}`} className="btn-quiet">Add to a role</Link>
                              </>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) }] : []),
          { id: "booking", label: "Said yes", count: buckets.saidYesNeverBooked.length, panel: (
            <Bucket
              readOnly={readOnly}
              title="Said yes, never booked"
              description={`Keen but no booking after ${settings.bookingChaseDays} ${settings.bookingChaseDays === 1 ? "day" : "days"}.`}
              rows={buckets.saidYesNeverBooked}
              run={features.followUpRuns ? "/followups/run?only=b" : undefined}
              actions={(row) => (
                <>
                  <Link href={`/candidates/${row.candidateId}/outreach`} className="btn-quiet">
                    Draft nudge
                  </Link>
                  <QuickStageButton candidateId={row.candidateId} stage="booked" label="Mark booked" />
                  <QuickStageButton candidateId={row.candidateId} stage="rejected" label="Mark rejected" />
                </>
              )}
            />
          ) },
          { id: "quiet", label: "Went quiet", count: buckets.wentQuiet.length, panel: (
            <Bucket
              readOnly={readOnly}
              title="Went quiet"
              description={`Contacted, no reply, and more than ${settings.quietNudgeDays} days have passed.`}
              rows={buckets.wentQuiet}
              run={features.followUpRuns ? "/followups/run?only=q" : undefined}
              actions={(row) => (
                <>
                  <Link href={`/candidates/${row.candidateId}/outreach`} className="btn-quiet">
                    Draft nudge
                  </Link>
                  <QuickStageButton candidateId={row.candidateId} stage="replied" label="They replied" />
                  <QuickStageButton candidateId={row.candidateId} stage="rejected" label="Mark rejected" />
                </>
              )}
            />
          ) },
          ...(features.revisitReminders ? [{ id: "revisit", label: "Due to revisit", count: revisits.length, panel: (
            <section aria-labelledby="revisit-heading" className="workspace-section">
              <h2 id="revisit-heading" className="sr-only">Due to revisit</h2>
              <p className="section-caption role-panel-head">People you said you would get back in touch with, due this week or overdue.</p>
              {revisits.length === 0 ? (
                <p className="text-ink/60">Nothing here. All clear.</p>
              ) : (
                <ul className="space-y-2">
                  {revisits.map((person) => (
                    <li key={person.id} className="card">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <Link href={`/people/${person.id}`} className="font-medium underline-offset-2 hover:underline">{person.fullName}</Link>
                        <span className={`text-sm tabular ${person.revisitOn! < now ? "text-rose-900" : "text-ink/60"}`}>
                          {person.revisitOn! < now ? "Overdue since" : "Due"} {factDate.format(person.revisitOn!)}
                        </span>
                      </div>
                      {person.revisitNote && <p className="mt-1 text-sm text-ink/80">{person.revisitNote}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link href={`/people/${person.id}`} className="btn-quiet">Open record</Link>
                        <ActionForm action={setRevisit}>
                          <input type="hidden" name="personId" value={person.id} />
                          <input type="hidden" name="intent" value="clear" />
                          <button type="submit" className="btn-quiet">Done, clear reminder</button>
                        </ActionForm>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) }] : []),
        ]}
      />
    </fieldset>
  );
}
