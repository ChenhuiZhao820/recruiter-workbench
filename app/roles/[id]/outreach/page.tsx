import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { getSettings } from "@/lib/settings";
import { firstName, renderTemplate } from "@/lib/render";
import { formatWhen } from "@/lib/dates";
import { profileHref } from "@/lib/urls";
import { limitForKind, templateKindLabel } from "@/lib/templates";
import { STAGE_LABELS, isStage } from "@/lib/stages";
import { paceAdvice, sevenDaysAgo, startOfToday } from "@/lib/pace";
import { messageComposeUrl } from "@/lib/linkedin";
import { OutreachStep } from "@/components/OutreachStep";
import { StageBadge } from "@/components/StageBadge";

export const dynamic = "force-dynamic";

// One shortlist, one template, one person on screen at a time.
//
// What this removes is navigation: going back to the role, finding the next
// name, opening it, picking the same template again. What it deliberately does
// NOT do is send anything, open anything on its own, paste into anything, or
// move on by itself. Every message is still pasted and sent by the recruiter,
// in LinkedIn, one at a time, at whatever pace they choose - which is also the
// only pace LinkedIn will not punish them for. Nothing here may ever grow an
// "open all", an auto-advance, a countdown, or a bulk send: that is what turns
// a recruiter's own account into an automated one in LinkedIn's eyes, and the
// restriction would land on them, not on us.

// A shortlist long enough to be a batch, short enough to stay an address.
const MAX_QUEUE = 100;

function queueHref(roleId: string, templateId: string, ids: string[], index: number): string {
  const params = new URLSearchParams();
  if (templateId) params.set("template", templateId);
  for (const id of ids) params.append("c", id);
  params.set("i", String(index));
  return `/roles/${roleId}/outreach?${params.toString()}`;
}

export default async function RoleOutreachPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { template?: string; c?: string | string[]; i?: string };
}) {
  const { owner, readOnly } = await getWorkspace();
  const [role, templates, settings] = await Promise.all([
    db.role.findUnique({
      where: { id: params.id, userId: owner.id },
      include: {
        candidates: {
          orderBy: [{ stage: "asc" }, { lastActivityAt: "desc" }],
          include: { outreach: { orderBy: { sentAt: "desc" }, take: 1 } },
        },
      },
    }),
    db.messageTemplate.findMany({ where: { userId: owner.id }, orderBy: { updatedAt: "desc" } }),
    getSettings(),
  ]);
  if (!role) notFound();

  const selected = templates.find((t) => t.id === searchParams.template) ?? templates[0] ?? null;

  // Whatever the address asked for, reduced to this role's own candidates, in
  // the order it asked for them. An id that is not here - somebody else's, or
  // deleted since the queue was built - is simply not in the queue.
  const asked = (Array.isArray(searchParams.c) ? searchParams.c : searchParams.c ? [searchParams.c] : [])
    .filter((id, index, all) => id && all.indexOf(id) === index)
    .slice(0, MAX_QUEUE);
  const byId = new Map(role.candidates.map((c) => [c.id, c]));
  const queue = asked.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c));

  const header = (
    <header className="page-header">
      <div>
        <p className="page-eyebrow">Roles / Outreach</p>
        <h1>Send outreach</h1>
        <p className="page-description">
          <Link href={`/roles/${role.id}`} className="underline">
            {role.title}
          </Link>
          {role.client ? ` · ${role.client}` : ""}
        </p>
      </div>
    </header>
  );

  if (templates.length === 0) {
    return (
      <fieldset disabled={readOnly} className="min-w-0 max-w-4xl space-y-8">
        {header}
        <div className="card empty-state text-ink-soft">
          <p>
            You have no message templates yet.{" "}
            <Link href="/templates" className="underline">
              Create one first
            </Link>
            .
          </p>
        </div>
      </fieldset>
    );
  }

  // --- picking the shortlist ------------------------------------------------

  if (queue.length === 0) {
    const candidates = role.candidates;
    return (
      <fieldset disabled={readOnly} className="min-w-0 max-w-4xl space-y-8">
        {header}
        {asked.length > 0 && (
          <p role="alert" className="card text-sm text-rose-900">
            None of those candidates are on this role any more. Pick the shortlist again.
          </p>
        )}
        {candidates.length === 0 ? (
          <div className="card empty-state text-ink-soft">
            <p>
              No candidates on this role yet.{" "}
              <Link href={`/roles/${role.id}`} className="underline">
                Add some first
              </Link>
              .
            </p>
          </div>
        ) : (
          <form method="get" action={`/roles/${role.id}/outreach`} className="card space-y-5">
            <div>
              <label htmlFor="template" className="field-label">
                Template
              </label>
              <select id="template" name="template" defaultValue={selected?.id} className="field-input">
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {templateKindLabel(t.kind)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-sm text-ink-soft">
                One template for the whole run. Each message is still rendered for the person
                in front of you, and you can edit it before you send it.
              </p>
            </div>

            <fieldset className="space-y-2">
              <legend className="field-label">Who to write to</legend>
              <p className="text-sm text-ink-soft">
                Sourced candidates are ticked. Anyone already contacted is not, so a second
                message is always a decision rather than an oversight.
              </p>
              <ul className="space-y-2">
                {candidates.map((c) => {
                  const last = c.outreach[0];
                  return (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 rounded border border-line bg-sunken p-3">
                      <input
                        type="checkbox"
                        id={`c-${c.id}`}
                        name="c"
                        value={c.id}
                        defaultChecked={c.stage === "sourced"}
                        className="h-4 w-4"
                      />
                      <label htmlFor={`c-${c.id}`} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{c.fullName}</span>
                        {c.headline && <span className="text-ink/70">· {c.headline}</span>}
                        <StageBadge stage={c.stage} />
                        {last && (
                          <span className="text-ink/60">last written to {formatWhen(last.sentAt)}</span>
                        )}
                        {!profileHref(c.profileUrl) && (
                          <span className="text-ink/60">no profile link saved</span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>

            <input type="hidden" name="i" value="0" />
            <button type="submit" className="btn-primary">
              Start
            </button>
            <p className="text-sm text-ink/60">
              Capture never messages anyone. This walks you through the shortlist one person at
              a time; you paste and send each message yourself, in LinkedIn.
            </p>
          </form>
        )}
      </fieldset>
    );
  }

  // --- working through it ---------------------------------------------------

  const ids = queue.map((c) => c.id);
  const templateId = selected?.id ?? "";
  const requested = Number.parseInt(searchParams.i ?? "0", 10);
  const index = Number.isFinite(requested) && requested > 0 ? requested : 0;

  const now = new Date();
  const [sentToday, invitesLast7Days] = await Promise.all([
    db.outreachLog.count({
      where: { candidate: { role: { userId: owner.id } }, sentAt: { gte: startOfToday(now) } },
    }),
    db.outreachLog.count({
      where: {
        candidate: { role: { userId: owner.id } },
        kind: "connection_note",
        sentAt: { gte: sevenDaysAgo(now) },
      },
    }),
  ]);
  const pace = paceAdvice({ sentToday, invitesLast7Days });
  const paceClass =
    pace.tone === "warning"
      ? "border-rose-300 bg-rose-50 text-rose-900"
      : pace.tone === "notice"
        ? "border-line bg-sunken text-ink"
        : "border-line bg-sunken text-ink-soft";

  if (index >= queue.length) {
    return (
      <fieldset disabled={readOnly} className="min-w-0 max-w-4xl space-y-8">
        {header}
        <section className="card space-y-3">
          <h2 className="text-lg">That is the whole shortlist.</h2>
          <p className="text-ink-soft">
            {queue.length} {queue.length === 1 ? "person" : "people"} walked through. Anything you
            marked as sent is on the role now.
          </p>
          <p className={`rounded border p-3 text-sm ${paceClass}`} role={pace.tone === "warning" ? "alert" : undefined}>
            {pace.text}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/roles/${role.id}`} className="btn-primary">
              Back to the role
            </Link>
            <Link href={`/roles/${role.id}/outreach`} className="btn-quiet">
              Start another run
            </Link>
          </div>
        </section>
      </fieldset>
    );
  }

  const candidate = queue[index];
  const rendered = selected
    ? renderTemplate(selected.body, {
        first_name: firstName(candidate.fullName),
        role_title: role.title,
        calendar_link: settings.calendarLink,
        recruiter_name: settings.recruiterName,
      })
    : "";
  const kind = selected?.kind ?? "message";
  const kindLimit = limitForKind(kind);
  const lastSent = candidate.outreach[0];
  // The message box directly when LinkedIn's own id for this person was read
  // when they were saved; otherwise their profile, and the Message button is
  // theirs to find. Either way it is one address, opened on one click.
  const compose = messageComposeUrl(candidate.memberId);
  const profile = profileHref(candidate.profileUrl);
  const openUrl = compose || profile || "";
  const next = queueHref(role.id, templateId, ids, index + 1);
  const previous = index > 0 ? queueHref(role.id, templateId, ids, index - 1) : "";

  return (
    <fieldset disabled={readOnly} className="min-w-0 max-w-4xl space-y-8">
      {header}

      <section aria-label="Progress" className="card space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-mono text-sm uppercase tracking-wide text-ink/70">
            {index + 1} of {queue.length}
          </p>
          <p className="text-sm text-ink-soft">
            Template: {selected?.name} · {templateKindLabel(kind)}
          </p>
        </div>
        <ol className="flex flex-wrap gap-1" aria-label="Shortlist">
          {queue.map((c, i) => (
            <li
              key={c.id}
              aria-current={i === index ? "true" : undefined}
              className={`chip ${i === index ? "border-accent bg-accent-soft text-accent" : i < index ? "text-ink/40" : ""}`}
            >
              {c.fullName}
            </li>
          ))}
        </ol>
        <p className={`rounded border p-3 text-sm ${paceClass}`} role={pace.tone === "warning" ? "alert" : undefined}>
          {pace.text}
        </p>
      </section>

      <section aria-label="This candidate" className="card space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg">{candidate.fullName}</h2>
          <StageBadge stage={candidate.stage} />
          {isStage(candidate.stage) && candidate.stage !== "sourced" && (
            <span className="text-sm text-rose-900">
              Already {STAGE_LABELS[candidate.stage].toLowerCase()}
              {lastSent ? `, last written to ${formatWhen(lastSent.sentAt)}` : ""}. Check before
              writing again.
            </span>
          )}
        </div>
        {candidate.headline && <p className="text-sm text-ink/70">{candidate.headline}</p>}
        {candidate.notes && <p className="text-sm text-ink/80">{candidate.notes}</p>}

        <p className="text-sm text-ink-soft">
          Sent as a {templateKindLabel(kind).toLowerCase()}.
          {!openUrl && " No profile link saved for this candidate."}
        </p>

        <OutreachStep
          // Keyed by the person and the template, so moving through the queue
          // remounts the editable draft. Without it React keeps the same
          // component instance, and the message typed for the last person
          // would sit under the next person's name - and be recorded as theirs.
          key={`${candidate.id}-${templateId}`}
          candidateId={candidate.id}
          templateId={templateId}
          initialBody={rendered}
          openUrl={readOnly ? "" : openUrl}
          opensMessageBox={Boolean(compose)}
          next={next}
          isLast={index + 1 === queue.length}
          limit={kindLimit}
          readOnly={readOnly}
        />

        <div className="flex flex-wrap items-center gap-2">
          {previous && (
            <Link href={previous} className="btn-quiet">
              Back to {firstName(queue[index - 1].fullName)}
            </Link>
          )}
          <Link href={next} className="btn-quiet">
            {index + 1 === queue.length ? "Skip and finish" : "Skip for now"}
          </Link>
          <Link href={`/roles/${role.id}`} className="btn-quiet">
            Stop here
          </Link>
          <Link href={`/candidates/${candidate.id}/outreach`} className="btn-quiet">
            Open on their own page
          </Link>
        </div>
      </section>
    </fieldset>
  );
}
