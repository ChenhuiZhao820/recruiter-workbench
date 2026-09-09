import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { getSettings } from "@/lib/settings";
import { firstName, hasGaps as messageHasGaps, renderTemplate } from "@/lib/render";
import { formatWhen } from "@/lib/dates";
import { profileHref } from "@/lib/urls";
import { markAsSent } from "@/app/actions/outreach";
import { limitForKind, templateKindLabel } from "@/lib/templates";
import { CopyButton } from "@/components/CopyButton";
import { StageBadge } from "@/components/StageBadge";

export const dynamic = "force-dynamic";

export default async function OutreachPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { template?: string };
}) {
  const { owner, readOnly } = await getWorkspace();
  const [candidate, templates, settings] = await Promise.all([
    db.candidate.findUnique({
      where: { id: params.id, role: { userId: owner.id } },
      include: {
        role: { select: { id: true, title: true } },
        outreach: { orderBy: { sentAt: "desc" } },
      },
    }),
    db.messageTemplate.findMany({ where: { userId: owner.id }, orderBy: { updatedAt: "desc" } }),
    getSettings(),
  ]);
  if (!candidate) notFound();

  const selected =
    templates.find((t) => t.id === searchParams.template) ?? templates[0] ?? null;

  const rendered = selected
    ? renderTemplate(selected.body, {
        first_name: firstName(candidate.fullName),
        role_title: candidate.role.title,
        calendar_link: settings.calendarLink,
        recruiter_name: settings.recruiterName,
      })
    : "";
  const hasGaps = messageHasGaps(rendered);
  // The cap applies to the rendered text, not the template, because the
  // placeholders change its length for every candidate.
  const selectedKind = selected?.kind ?? "message";
  const kindLimit = limitForKind(selectedKind);
  const overBy = kindLimit === null ? 0 : rendered.length - kindLimit;
  const recentOutreach = candidate.outreach.slice(0, 3);
  const olderOutreach = candidate.outreach.slice(3);

  return (
    <fieldset disabled={readOnly} className="min-w-0 max-w-4xl space-y-8">
      <header className="page-header">
        <div>
        <p className="page-eyebrow">Candidates / Conversation</p>
        <h1>Outreach</h1>
        <p className="page-description flex flex-wrap items-center gap-2">
          {candidate.fullName} ·{" "}
          <Link href={`/roles/${candidate.role.id}`} className="underline">
            {candidate.role.title}
          </Link>{" "}
          · <StageBadge stage={candidate.stage} />
        </p>
        </div>
      </header>

      {templates.length === 0 ? (
        <div className="card empty-state text-ink-soft">
          <p>
            You have no message templates yet.{" "}
            <Link href="/templates" className="underline">
              Create one first
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <nav aria-label="Pick a template" className="card">
            <h2 className="field-label">Template</h2>
            <ul className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/candidates/${candidate.id}/outreach?template=${t.id}`}
                    className={
                      t.id === selected?.id
                        ? "btn-secondary border-accent bg-accent-soft text-accent"
                        : "btn-quiet"
                    }
                    aria-current={t.id === selected?.id ? "true" : undefined}
                  >
                    {t.name}
                    <span className="ml-1.5 font-mono text-[0.65rem] uppercase tracking-wider opacity-70">
                      {templateKindLabel(t.kind)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <section aria-label="Message preview" className="card space-y-4">
            <div className="whitespace-pre-wrap rounded border border-line bg-sunken p-4">
              {rendered}
            </div>
            <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-ink-soft">
              <span>
                Sent as a {templateKindLabel(selectedKind).toLowerCase()}.
              </span>
              <span className={`font-mono text-xs tabular ${overBy > 0 ? "text-rose-900" : ""}`}>
                {kindLimit === null
                  ? `${rendered.length} characters`
                  : `${rendered.length} / ${kindLimit}`}
              </span>
            </p>
            {overBy > 0 && (
              <p role="alert" className="text-sm text-rose-900">
                This is {overBy} {overBy === 1 ? "character" : "characters"} over the
                connection-note limit once {firstName(candidate.fullName)}&rsquo;s details are
                filled in. Trim it in{" "}
                <Link href="/templates" className="underline">
                  Templates
                </Link>{" "}
                or shorten it after pasting.
              </p>
            )}
            {hasGaps && (
              <p role="alert" className="text-sm text-rose-900">
                This message still has gaps. Anything marked [MISSING] needs a detail
                filling in — the calendar link lives in{" "}
                <Link href="/settings" className="underline">
                  Settings
                </Link>
                . Anything marked [UNKNOWN] is a placeholder this app cannot fill, so
                edit it out in{" "}
                <Link href="/templates" className="underline">
                  Templates
                </Link>
                . You cannot mark this as sent until the gaps are gone.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton text={rendered} label="Copy message" hasGaps={hasGaps} />
              {profileHref(candidate.profileUrl) ? (
                <a
                  href={readOnly ? undefined : profileHref(candidate.profileUrl)!}
                  aria-disabled={readOnly}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary"
                >
                  Open profile
                </a>
              ) : (
                <span className="text-sm text-ink/60">No profile link saved for this candidate.</span>
              )}
            </div>
            <p className="text-sm text-ink/60">
              You send this yourself on LinkedIn. This app never messages anyone.
            </p>
            <form action={markAsSent}>
              <input type="hidden" name="candidateId" value={candidate.id} />
              <input type="hidden" name="templateId" value={selected?.id ?? ""} />
              <input type="hidden" name="renderedBody" value={rendered} />
              <button type="submit" className="btn-secondary" disabled={hasGaps}>
                Mark as sent
              </button>
              <span className="ml-2 text-sm text-ink/60">
                {hasGaps
                  ? "Fill the gaps above before recording this as sent."
                  : "Click this after you have sent the message on LinkedIn."}
              </span>
            </form>
          </section>
        </>
      )}

      {candidate.outreach.length > 0 && (
        <section aria-label="Past outreach" className="card">
          <h2 className="mb-2 text-lg">
            Past outreach ({candidate.outreach.length})
          </h2>
          <ul className="space-y-2">
            {recentOutreach.map((o) => (
              <li key={o.id} className="rounded border border-line bg-sunken p-3 text-sm">
                <p className="mb-1 flex flex-wrap items-center gap-2 text-ink/60">
                  <span className="chip">{templateKindLabel(o.kind)}</span>
                  <span>sent {formatWhen(o.sentAt)}</span>
                </p>
                <p className="whitespace-pre-wrap">{o.renderedBody}</p>
              </li>
            ))}
          </ul>
          {olderOutreach.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-ink/70">
                Show {olderOutreach.length} older{" "}
                {olderOutreach.length === 1 ? "message" : "messages"}
              </summary>
              <ul className="mt-2 space-y-2">
                {olderOutreach.map((o) => (
                  <li key={o.id} className="rounded border border-line bg-sunken p-3 text-sm">
                    <p className="mb-1 flex flex-wrap items-center gap-2 text-ink/60">
                      <span className="chip">{templateKindLabel(o.kind)}</span>
                      <span>sent {formatWhen(o.sentAt)}</span>
                    </p>
                    <p className="whitespace-pre-wrap">{o.renderedBody}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </fieldset>
  );
}
