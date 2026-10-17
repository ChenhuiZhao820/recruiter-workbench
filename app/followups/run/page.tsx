import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireFeature } from "@/lib/feature-access";
import { getFollowUpBuckets } from "@/lib/followups";
import { getSettings } from "@/lib/settings";
import { firstName, hasGaps, renderTemplate } from "@/lib/render";
import { bookingLinkFor } from "@/lib/booking";
import { privacyNoticeLine } from "@/lib/booking-core.mjs";
import { formatWhen } from "@/lib/dates";
import { profileHref } from "@/lib/urls";
import { limitForKind, templateKindLabel } from "@/lib/templates";
import { messageComposeUrl } from "@/lib/linkedin";
import { BUILT_IN_TEMPLATES, GROUPS, GROUP_LABELS, planRun, readRunEntries, runHref } from "@/lib/followup-run.mjs";
import { utcDayStart } from "@/lib/outreach-log";
import { setStageAndAdvance } from "@/app/actions/outreach";
import { OutreachStep } from "@/components/OutreachStep";
import { StageBadge } from "@/components/StageBadge";
import { Icon } from "@/components/Icon";
import { RememberRun, StartRunButton, TemplateSelect } from "@/components/FollowUpRun";

export const dynamic = "force-dynamic";

// Everyone due a follow-up, across roles, walked through one person at a time.
//
// Like the role outreach queue, this removes navigation and nothing else: it
// never sends, never opens LinkedIn by itself, never moves on without a click,
// and has no control that acts on more than the person on screen. The list is
// worked out from the follow-up buckets, ticked with reasons, and the
// recruiter changes it before starting. The address is the whole run.

type Params = { c?: string | string[]; i?: string; tb?: string; tq?: string; review?: string; only?: string };
type Group = "r" | "b" | "q";

const OUTCOMES: Record<Group, { stage: string; label: string }[]> = {
  r: [{ stage: "booking_pending", label: "They said yes" }, { stage: "rejected", label: "Mark rejected" }],
  b: [{ stage: "booked", label: "Mark booked" }, { stage: "rejected", label: "Mark rejected" }],
  q: [{ stage: "replied", label: "They replied" }, { stage: "rejected", label: "Mark rejected" }],
};

export default async function FollowUpRunPage({ searchParams }: { searchParams: Params }) {
  const { owner, readOnly } = await requireFeature("followUpRuns");
  const [settings, templates] = await Promise.all([
    getSettings(),
    db.messageTemplate.findMany({ where: { userId: owner.id }, orderBy: { updatedAt: "desc" } }),
  ]);
  const chosen: Record<"b" | "q", string> = {
    b: templates.some((t) => t.id === searchParams.tb) ? searchParams.tb! : "",
    q: templates.some((t) => t.id === searchParams.tq) ? searchParams.tq! : "",
  };
  const entries = readRunEntries(searchParams.c);

  const header = (
    <header className="page-header">
      <div>
        <p className="page-eyebrow">Follow-ups / Run</p>
        <h1>Follow up in batches</h1>
        <p className="page-description">
          Everyone due a follow-up, one person at a time. You send each message yourself in LinkedIn; Capture never messages anyone.
        </p>
      </div>
      <Link href="/followups" className="btn-quiet">Back to follow-ups</Link>
    </header>
  );

  // The message for one person in a group, from the chosen template or the
  // built-in one.
  const messageFor = (
    group: Group,
    candidate: { id: string; fullName: string; stage: string; role: { title: string; status: string }; person: { doNotContact: boolean } | null },
  ) => {
    if (group === "r") return { body: "", kind: "message", templateId: "" };
    const template = templates.find((t) => t.id === chosen[group]);
    const booking = bookingLinkFor(candidate, settings);
    const source = template?.body ?? (group === "b" && !booking ? BUILT_IN_TEMPLATES.bNoLink : BUILT_IN_TEMPLATES[group]);
    return {
      body: renderTemplate(source, {
        first_name: firstName(candidate.fullName),
        role_title: candidate.role.title,
        calendar_link: settings.calendarLink,
        recruiter_name: settings.recruiterName,
        booking_link: booking,
        privacy_notice: privacyNoticeLine(settings.privacyContactEmail || owner.email),
      }),
      kind: template?.kind ?? "message",
      templateId: template?.id ?? "",
    };
  };

  // --- choosing who ---------------------------------------------------------

  if (entries.length === 0 || searchParams.review === "1") {
    const buckets = await getFollowUpBuckets();
    const only = GROUPS.find((group: Group) => group === searchParams.only) ?? null;
    const planned = planRun(buckets, { only }).map((row: ReturnType<typeof planRun>[number]) =>
      // Re-read after a template change: the ticks are the recruiter's now.
      searchParams.review === "1" && !row.locked
        ? { ...row, checked: entries.some((entry: { candidateId: string }) => entry.candidateId === row.row.candidateId) }
        : row,
    );
    const ids = planned.map((row: { row: { candidateId: string } }) => row.row.candidateId);
    const people = await db.candidate.findMany({
      where: { id: { in: ids }, role: { userId: owner.id } },
      include: { role: true, person: { select: { doNotContact: true } } },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    const templateOptions = [
      { value: "", label: "Capture's follow-up" },
      ...templates.map((t) => ({ value: t.id, label: `${t.name} - ${templateKindLabel(t.kind)}` })),
    ];

    if (planned.length === 0) {
      return (
        <div className="min-w-0 max-w-4xl space-y-8">
          {header}
          <section className="card space-y-3">
            <h2 className="text-lg">Nobody is due a follow-up right now.</h2>
            <p className="text-ink-soft">People appear here when they reply, say yes without booking, or go quiet for longer than you set in Settings.</p>
            <Link href="/followups" className="btn-secondary">Back to follow-ups</Link>
          </section>
        </div>
      );
    }

    return (
      <fieldset disabled={readOnly} className="min-w-0 max-w-4xl space-y-8">
        {header}
        <form method="get" className="space-y-8">
          <input type="hidden" name="i" value="0" />
          <input type="hidden" name="review" value="" />
          {GROUPS.map((group: Group) => {
            const rows = planned.filter((row: { group: string }) => row.group === group);
            if (rows.length === 0) return null;
            const first = rows.find((row: { checked: boolean }) => row.checked) ?? rows[0];
            const firstCandidate = byId.get(first.row.candidateId);
            const preview = group !== "r" && firstCandidate ? messageFor(group, firstCandidate).body : "";
            return (
              <section key={group} aria-labelledby={`run-${group}`} className="workspace-section space-y-4">
                <div>
                  <h2 id={`run-${group}`} className="section-heading">
                    {GROUP_LABELS[group]} <span className="person-count tabular">{rows.length}</span>
                  </h2>
                  {group === "r" ? (
                    <p className="section-caption">
                      No template here: on each person, paste what they said and a suggested reply appears. Press Tab to use it, or write your own.
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <TemplateSelect name={`t${group}`} label={`Template for ${GROUP_LABELS[group]}`} defaultValue={chosen[group]} options={templateOptions} />
                      {preview && (
                        <details className="run-preview">
                          <summary>Preview for {firstName(firstCandidate!.fullName)}</summary>
                          <p className="message-body">{preview}</p>
                          {hasGaps(preview) && <p role="alert" className="text-sm text-rose-900">This template has gaps for this person. You can fill them in on their card before sending.</p>}
                        </details>
                      )}
                    </div>
                  )}
                </div>
                <ul className="space-y-2">
                  {rows.map((row: ReturnType<typeof planRun>[number]) => (
                    <li key={row.row.candidateId} className={`run-row${row.locked ? " run-row-locked" : ""}`}>
                      <input
                        type="checkbox"
                        id={`run-${row.row.candidateId}`}
                        name="c"
                        value={`${group}.${row.row.candidateId}`}
                        defaultChecked={row.checked}
                        disabled={row.locked}
                        className="h-4 w-4"
                      />
                      <label htmlFor={`run-${row.row.candidateId}`} className="min-w-0">
                        <span className="font-medium">{row.row.candidateName}</span>
                        <span className="text-ink-soft">{row.row.roleTitle}</span>
                        <span className="run-reason">{row.reason}</span>
                        {row.note && <span className="run-note">{row.note}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <div className="flex flex-wrap items-center gap-3">
            <StartRunButton initial={planned.filter((row: { checked: boolean }) => row.checked).length} />
            <p className="text-sm text-ink-soft">One person at a time. Mark as sent moves you to the next; the arrow takes you back.</p>
          </div>
        </form>
      </fieldset>
    );
  }

  // --- working through it ---------------------------------------------------

  const found = await db.candidate.findMany({
    where: { id: { in: entries.map((entry: { candidateId: string }) => entry.candidateId) }, role: { userId: owner.id } },
    include: {
      role: true,
      person: { select: { doNotContact: true } },
      outreach: { orderBy: { sentAt: "desc" }, take: 1 },
    },
  });
  const byId = new Map(found.map((c) => [c.id, c]));
  // Unknown or foreign ids are dropped, and so is anyone marked do not
  // contact since the run was made.
  const run = entries
    .map((entry: { group: Group; candidateId: string }) => ({ group: entry.group, candidate: byId.get(entry.candidateId) }))
    .filter((step: { candidate?: (typeof found)[number] }): step is { group: Group; candidate: (typeof found)[number] } => Boolean(step.candidate) && !step.candidate!.person?.doNotContact);
  // Nobody left to go through - all foreign, gone or do not contact: start
  // again from the list rather than claim a run happened.
  if (run.length === 0) redirect("/followups/run");
  const kept = run.map((step) => ({ group: step.group, candidateId: step.candidate.id }));
  const templateIds = { b: chosen.b, q: chosen.q };
  const requested = Number.parseInt(searchParams.i ?? "0", 10);
  const index = Number.isFinite(requested) && requested > 0 ? requested : 0;
  const here = runHref(kept, { templates: templateIds, index });

  if (index >= run.length) {
    const written = run.filter((step) => step.candidate.outreach[0] && step.candidate.outreach[0].sentAt >= utcDayStart(new Date())).length;
    return (
      <div className="min-w-0 max-w-4xl space-y-8">
        <RememberRun href={here} index={index} total={run.length} />
        {header}
        <section className="card space-y-3">
          <h2 className="text-lg">That is everyone.</h2>
          <p className="text-ink-soft">
            {run.length} {run.length === 1 ? "person" : "people"} gone through, {written} written to today.
            Anyone you nudged comes back to Follow-ups if they stay quiet past your follow-up days.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/followups" className="btn-primary">Back to follow-ups</Link>
          </div>
        </section>
      </div>
    );
  }

  const { group, candidate } = run[index];
  const message = messageFor(group, candidate);
  const compose = messageComposeUrl(candidate.memberId);
  const openUrl = compose || profileHref(candidate.profileUrl) || "";
  const next = runHref(kept, { templates: templateIds, index: index + 1 });
  const previous = index > 0 ? runHref(kept, { templates: templateIds, index: index - 1 }) : "";
  const lastSent = candidate.outreach[0];

  return (
    <fieldset disabled={readOnly} className="min-w-0 max-w-4xl space-y-8">
      <RememberRun href={here} index={index} total={run.length} />
      {header}

      <section aria-label="Progress" className="card space-y-3">
        <p className="font-mono text-sm uppercase tracking-wide text-ink/70">{index + 1} of {run.length}</p>
        <ol className="flex flex-wrap gap-1" aria-label="Run">
          {run.map((step, i) => (
            <li
              key={step.candidate.id}
              aria-current={i === index ? "true" : undefined}
              className={`chip ${i === index ? "border-accent bg-accent-soft text-accent" : i < index ? "text-ink/40" : ""}`}
            >
              {step.candidate.fullName}
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="This person" className="card space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {previous && (
            <Link
              href={previous}
              aria-label={`Back to ${firstName(run[index - 1].candidate.fullName)}`}
              title={`Back to ${firstName(run[index - 1].candidate.fullName)}`}
              className="-ml-1 inline-flex h-8 w-8 items-center justify-center rounded text-ink/60 hover:bg-sunken hover:text-ink"
            >
              <Icon name="back" size={18} />
            </Link>
          )}
          <h2 className="text-lg">
            <Link href={`/candidates/${candidate.id}/outreach`} className="underline decoration-line underline-offset-4 hover:decoration-ink">
              {candidate.fullName}
            </Link>
          </h2>
          <StageBadge stage={candidate.stage} />
        </div>
        <p className="text-sm text-ink-soft">
          {candidate.role.title}
          {lastSent ? ` · last written to ${formatWhen(lastSent.sentAt)}` : ""}
        </p>
        {lastSent && (
          <details className="run-preview">
            <summary>Your last message</summary>
            <p className="message-body">{lastSent.renderedBody}</p>
          </details>
        )}

        <OutreachStep
          // Keyed by the person, the group and the template, so moving on
          // remounts the editable draft rather than carrying the last one over.
          key={`${candidate.id}-${group}-${message.templateId}`}
          candidateId={candidate.id}
          templateId={message.templateId}
          initialBody={message.body}
          openUrl={readOnly ? "" : openUrl}
          opensMessageBox={Boolean(compose)}
          next={next}
          isLast={index + 1 === run.length}
          limit={limitForKind(message.kind)}
          readOnly={readOnly}
          sentLabel="Mark as sent"
          replyTo={group === "r" ? { candidateId: candidate.id, name: firstName(candidate.fullName) } : undefined}
        />

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <span className="text-sm text-ink-soft">Or, without a message:</span>
          {OUTCOMES[group].map((outcome) => (
            <form key={outcome.stage} action={setStageAndAdvance}>
              <input type="hidden" name="candidateId" value={candidate.id} />
              <input type="hidden" name="stage" value={outcome.stage} />
              <input type="hidden" name="next" value={next} />
              <button type="submit" className="btn-quiet">{outcome.label}</button>
            </form>
          ))}
          <Link href={next} className="btn-quiet">Skip</Link>
          <Link href="/followups" className="btn-quiet">Stop here</Link>
        </div>
      </section>
    </fieldset>
  );
}
