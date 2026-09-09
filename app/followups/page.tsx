import Link from "next/link";
import { getFollowUpBuckets, type FollowUpRow } from "@/lib/followups";
import { getSettings } from "@/lib/settings";
import { getWorkspace } from "@/lib/workspace";
import { formatWhen } from "@/lib/dates";
import { templateKindLabel } from "@/lib/templates";
import { profileHref } from "@/lib/urls";
import { setCandidateStage } from "@/app/actions/candidates";

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
  number,
  description,
  rows,
  actions,
  readOnly,
}: {
  title: string;
  number: string;
  description: string;
  rows: FollowUpRow[];
  readOnly: boolean;
  actions: (row: FollowUpRow) => React.ReactNode;
}) {
  return (
    <section aria-label={title} className="workspace-section">
      <h2 className="section-heading"><span className="section-number" aria-hidden="true">{number}</span>{title}</h2>
      <p className="section-caption mb-4">{description}</p>
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

export default async function FollowUpsPage() {
  const { readOnly } = await getWorkspace();
  const [buckets, settings] = await Promise.all([getFollowUpBuckets(), getSettings()]);

  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-8">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Pipeline / Next steps</p>
          <h1>Follow-ups today</h1>
          <p className="page-description">Keep the conversation moving. Built from your own notes and timestamps.</p>
        </div>
        <p className="chip">Work top to bottom</p>
      </header>

      <Bucket
        readOnly={readOnly}
        number="01"
        title="Replied, waiting on you"
        description="They answered and you have not responded yet."
        rows={buckets.repliedWaiting}
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

      <Bucket
        readOnly={readOnly}
        number="02"
        title="Said yes, never booked"
        description={`Keen but no booking after ${settings.bookingChaseDays} ${settings.bookingChaseDays === 1 ? "day" : "days"}.`}
        rows={buckets.saidYesNeverBooked}
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

      <Bucket
        readOnly={readOnly}
        number="03"
        title="Went quiet"
        description={`Contacted, no reply, and more than ${settings.quietNudgeDays} days have passed.`}
        rows={buckets.wentQuiet}
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
    </fieldset>
  );
}
