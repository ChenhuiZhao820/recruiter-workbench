import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { featureAvailability, requireFeature } from "@/lib/feature-access";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { TranscriptForm } from "@/components/TranscriptForm";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { StageBadge } from "@/components/StageBadge";
import { confirmScreening, confirmScreeningField, deleteTranscript, discardScreening } from "@/app/actions/screening";
import { FIELDS, parseSummary, type ConfirmedFact, type FactField, type FactValues, type ScreeningSummary } from "@/lib/screening";
import { FIELD_LABELS, REMOTE_OPTIONS, RIGHT_TO_WORK_OPTIONS, STALE_CLAIM_MS, monthKey, screeningMonthlyCap } from "@/lib/screening-core.mjs";
import { REMOTE_LABELS, RIGHT_TO_WORK_LABELS, factDate, factSummary } from "@/lib/fact-labels";
import { transcriptRetained } from "@/lib/retention";
import { suggestRevisitDate } from "@/lib/talent.mjs";
import { ClientEmailComposer } from "@/components/ClientEmailComposer";
import { clientEmailBody, clientEmailSubject } from "@/lib/client-email";
import { markClientEmailSent, recordRepresentConsent } from "@/app/actions/client-email";

export const dynamic = "force-dynamic";

function FactInputs({ field, value, id }: { field: FactField; value: FactValues[FactField]; id: string }) {
  if (field === "salary") {
    const v = value as FactValues["salary"];
    return (
      <div className="screening-inputs screening-inputs-salary">
        <div>
          <label htmlFor={`${id}-min`} className="field-label">From (a year)</label>
          <input id={`${id}-min`} name="min" inputMode="numeric" defaultValue={v.min ?? ""} className="field-input tabular" />
        </div>
        <div>
          <label htmlFor={`${id}-max`} className="field-label">To (a year)</label>
          <input id={`${id}-max`} name="max" inputMode="numeric" defaultValue={v.max ?? ""} className="field-input tabular" />
        </div>
        <div>
          <label htmlFor={`${id}-currency`} className="field-label">Currency</label>
          <input id={`${id}-currency`} name="currency" defaultValue={v.currency ?? "GBP"} maxLength={3} className="field-input uppercase" />
        </div>
        <div className="screening-inputs-wide">
          <label htmlFor={`${id}-note`} className="field-label">Note</label>
          <input id={`${id}-note`} name="note" defaultValue={v.note ?? ""} placeholder="Base only, day rate, current package..." className="field-input" />
        </div>
      </div>
    );
  }
  if (field === "notice") {
    const v = value as FactValues["notice"];
    return (
      <div className="screening-inputs">
        <div>
          <label htmlFor={`${id}-weeks`} className="field-label">Weeks</label>
          <input id={`${id}-weeks`} name="weeks" inputMode="numeric" defaultValue={v.weeks ?? ""} className="field-input tabular" />
        </div>
        <div>
          <label htmlFor={`${id}-from`} className="field-label">Available from</label>
          <input id={`${id}-from`} name="available_from" type="date" defaultValue={v.available_from ?? ""} className="field-input" />
        </div>
        <div className="screening-inputs-wide">
          <label htmlFor={`${id}-note`} className="field-label">Note</label>
          <input id={`${id}-note`} name="note" defaultValue={v.note ?? ""} placeholder="Negotiable, garden leave..." className="field-input" />
        </div>
      </div>
    );
  }
  if (field === "location") {
    const v = value as FactValues["location"];
    return (
      <div className="screening-inputs">
        <div>
          <label htmlFor={`${id}-location`} className="field-label">Based in</label>
          <input id={`${id}-location`} name="location" defaultValue={v.location ?? ""} className="field-input" />
        </div>
        <div>
          <label htmlFor={`${id}-remote`} className="field-label">Working pattern</label>
          <select id={`${id}-remote`} name="remote" defaultValue={v.remote ?? ""} className="field-input">
            <option value="">Not stated</option>
            {REMOTE_OPTIONS.map((option) => <option key={option} value={option}>{REMOTE_LABELS[option]}</option>)}
          </select>
        </div>
        <div className="screening-inputs-wide">
          <label htmlFor={`${id}-note`} className="field-label">Note</label>
          <input id={`${id}-note`} name="note" defaultValue={v.note ?? ""} placeholder="Two days in the office at most..." className="field-input" />
        </div>
      </div>
    );
  }
  const v = value as FactValues["right_to_work"];
  return (
    <div className="screening-inputs">
      <div className="screening-inputs-wide">
        <label htmlFor={`${id}-status`} className="field-label">Status</label>
        <select id={`${id}-status`} name="status" defaultValue={v.status ?? ""} className="field-input">
          <option value="">Not stated</option>
          {RIGHT_TO_WORK_OPTIONS.map((option) => <option key={option} value={option}>{RIGHT_TO_WORK_LABELS[option]}</option>)}
        </select>
      </div>
      <div className="screening-inputs-wide">
        <label htmlFor={`${id}-note`} className="field-label">Note</label>
        <input id={`${id}-note`} name="note" defaultValue={v.note ?? ""} placeholder="Visa type, expiry..." className="field-input" />
      </div>
    </div>
  );
}

function FactCard({ screeningId, field, summary }: { screeningId: string; field: FactField; summary: ScreeningSummary }) {
  const ai = summary.ai[field];
  const mine = summary.fields[field] as ConfirmedFact<FactField>;
  const id = `fact-${field}`;
  const shown = factSummary(field, mine);
  return (
    <section aria-labelledby={`${id}-heading`} className="screening-fact" data-confirmed={mine.confirmed}>
      <header className="screening-fact-head">
        <h3 id={`${id}-heading`}>{FIELD_LABELS[field]}</h3>
        <span className={`chip ${mine.confirmed ? "screening-chip-done" : ""}`}>{mine.confirmed ? "Confirmed" : "To check"}</span>
      </header>

      {ai.not_discussed ? (
        <p className="screening-quote screening-quote-none">Nothing about this was found in the call.</p>
      ) : ai.evidence ? (
        <blockquote className="screening-quote">
          <p>&ldquo;{ai.evidence}&rdquo;</p>
        </blockquote>
      ) : (
        <p className="screening-quote screening-quote-missing" role="note">
          <strong>No quote found.</strong> The summary gave a value but could not point to where they said it. Check it against your memory of the call.
        </p>
      )}

      {mine.confirmed ? (
        <ActionForm action={confirmScreeningField} className="screening-fact-done">
          <input type="hidden" name="screeningId" value={screeningId} />
          <input type="hidden" name="field" value={field} />
          <input type="hidden" name="intent" value="edit" />
          <div className="min-w-0">
            <p className="screening-fact-value">{shown.value}</p>
            {shown.note && <p className="screening-fact-note">{shown.note}</p>}
          </div>
          <SubmitButton className="btn-quiet" pendingLabel="Opening...">Edit</SubmitButton>
        </ActionForm>
      ) : (
        <ActionForm action={confirmScreeningField} className="space-y-4">
          <input type="hidden" name="screeningId" value={screeningId} />
          <input type="hidden" name="field" value={field} />
          <FactInputs field={field} value={mine.value} id={id} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="not_discussed" defaultChecked={mine.not_discussed} className="screening-check" />
              Not discussed
            </label>
            <SubmitButton className="btn-secondary" pendingLabel="Saving...">Confirm</SubmitButton>
          </div>
        </ActionForm>
      )}
    </section>
  );
}

export default async function ScreeningPage({ params }: { params: { id: string } }) {
  const { owner, readOnly } = await requireFeature("screening");
  const candidate = await db.candidate.findFirst({
    where: { id: params.id, role: { userId: owner.id } },
    include: {
      role: { select: { id: true, title: true, client: true } },
      person: { select: { id: true, doNotContact: true, skillsSummary: true, motivation: true } },
      screenings: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!candidate) notFound();
  const features = await featureAvailability();
  const settings = await db.settings.findUnique({ where: { userId: owner.id }, select: { recruiterName: true } });

  const now = new Date();
  const usage = await db.aiUsage.findUnique({ where: { userId_month: { userId: owner.id, month: monthKey(now) } } });
  const cap = screeningMonthlyCap();
  const used = usage?.generations ?? 0;

  const open = candidate.screenings.find((screening) => screening.status !== "confirmed") ?? null;
  const lastConfirmed = candidate.screenings.find((screening) => screening.status === "confirmed") ?? null;
  const current = open ?? lastConfirmed;
  // A claim the server abandoned shows the form again, so the call can be retried.
  const working = open?.status === "working" && open.updatedAt.getTime() > now.getTime() - STALE_CLAIM_MS;
  const summary = current ? parseSummary(current.summaryJson) : null;
  const transcript = current && transcriptRetained(current, now) ? current.transcript : null;
  const firstName = candidate.fullName.split(/\s+/)[0];
  const clientName = candidate.role.client || "this client";
  const remaining = summary ? FIELDS.filter((field) => !summary.fields[field].confirmed).length : 0;

  return (
    <fieldset disabled={readOnly} className="min-w-0">
      <header className="page-header">
        <div className="min-w-0">
          <p className="page-eyebrow">
            <Link href={`/roles/${candidate.role.id}`} className="hover:text-ink">{candidate.role.title}</Link> / Screening
          </p>
          <h1>Screening call with {candidate.fullName}</h1>
          <p className="page-description">
            {candidate.role.title}{candidate.role.client ? ` for ${candidate.role.client}` : ""}. The summary is a draft: you confirm each fact before it is saved to their record.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StageBadge stage={candidate.stage} />
          {candidate.person?.doNotContact && <span className="chip person-flag">Do not contact</span>}
        </div>
      </header>

      <div className="person-layout">
        <div className="min-w-0 space-y-10">
          {!current || (open && open.status !== "summarized" && !working) ? (
            <section aria-labelledby="add-heading" className="space-y-4">
              <div>
                <h2 id="add-heading" className="section-heading">Add the call transcript</h2>
                <p className="section-caption">
                  {open ? `Saved ${factDate.format(open.createdAt)} but not summarised yet. Summarise it, or change it first.` : "One call per summary."}
                </p>
              </div>
              <TranscriptForm candidateId={candidate.id} initialTranscript={open && transcript ? transcript : ""} initialSource={open?.transcriptSource ?? "paste"} />
            </section>
          ) : working ? (
            <section aria-labelledby="working-heading" className="screening-working" aria-live="polite">
              <h2 id="working-heading" className="section-heading">Summarising the call</h2>
              <p className="section-caption">This usually takes under a minute. Reload the page to see the result.</p>
              <div className="screening-skeleton" aria-hidden="true">
                {FIELDS.map((field) => <span key={field} />)}
              </div>
            </section>
          ) : summary && current.status === "summarized" ? (
            <>
              <section aria-labelledby="facts-heading" className="space-y-4">
                <div>
                  <h2 id="facts-heading" className="section-heading">Check the four facts</h2>
                  <p className="section-caption">
                    Each value is the summary&rsquo;s reading of the call. Check it against the quote, correct it if needed, and confirm it.
                  </p>
                </div>
                <div className="screening-facts">
                  {FIELDS.map((field) => <FactCard key={field} screeningId={current.id} field={field} summary={summary} />)}
                </div>
              </section>

              <section aria-labelledby="save-heading" className="space-y-4">
                <div>
                  <h2 id="save-heading" className="section-heading">Save to their record</h2>
                  <p className="section-caption">Also from the call. Edit anything before saving; the concerns are for you and are not saved to their record.</p>
                </div>
                <ActionForm action={confirmScreening} className="screening-save">
                  <input type="hidden" name="screeningId" value={current.id} />
                  <div>
                    <label htmlFor="skillsSummary" className="field-label">Skills they described</label>
                    <textarea id="skillsSummary" name="skillsSummary" rows={2} defaultValue={summary.ai.skills.join(", ")} className="field-input" />
                  </div>
                  <div>
                    <label htmlFor="motivation" className="field-label">Why they would move</label>
                    <textarea
                      id="motivation"
                      name="motivation"
                      rows={2}
                      defaultValue={[summary.ai.motivation, summary.ai.reason_for_leaving].filter(Boolean).join(" ")}
                      className="field-input"
                    />
                  </div>
                  {(summary.ai.concerns.length > 0 || summary.ai.revisit_hint) && (
                    <dl className="screening-extras">
                      {summary.ai.concerns.length > 0 && (
                        <div>
                          <dt>Worth knowing</dt>
                          <dd>
                            <ul>{summary.ai.concerns.map((concern, index) => <li key={index}>{concern}</li>)}</ul>
                          </dd>
                        </div>
                      )}
                      {summary.ai.revisit_hint && (
                        <div>
                          <dt>When to get back in touch</dt>
                          <dd>{summary.ai.revisit_hint}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                  {features.revisitReminders && (
                    <div className="screening-revisit">
                      <div>
                        <label htmlFor="revisitOn" className="field-label">Get back in touch on (optional)</label>
                        <input id="revisitOn" name="revisitOn" type="date" defaultValue={suggestRevisitDate(summary.ai.revisit_hint, now) ?? ""} className="field-input" />
                      </div>
                      <div>
                        <label htmlFor="revisitNote" className="field-label">Why</label>
                        <input id="revisitNote" name="revisitNote" defaultValue={summary.ai.revisit_hint ?? ""} className="field-input" />
                      </div>
                      <p className="screening-revisit-help text-xs text-ink-soft">Shows in Follow-ups the week it is due. Leave the date empty for no reminder.</p>
                    </div>
                  )}
                  <label className="screening-consent">
                    <input type="checkbox" name="represent" className="screening-check" />
                    <span>
                      {firstName} agreed to be put forward to {clientName}
                      <span className="block text-xs text-ink-soft">Only tick this if they said so on the call. You will need it to send their details to the client.</span>
                    </span>
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <SubmitButton pendingLabel="Saving..." disabled={remaining > 0}>Save to their record</SubmitButton>
                    <p className="text-xs text-ink-soft" role="status">
                      {remaining > 0 ? `Confirm ${remaining} more ${remaining === 1 ? "fact" : "facts"} first.` : "Moves them to Screened."}
                    </p>
                  </div>
                </ActionForm>
                <form action={discardScreening}>
                  <input type="hidden" name="screeningId" value={current.id} />
                  <ConfirmSubmitButton label="Discard this summary" confirmText="Discard this summary and its transcript? Nothing has been saved to their record yet. This cannot be undone." />
                </form>
              </section>
            </>
          ) : summary && current.status === "confirmed" ? (
            <section aria-labelledby="done-heading" className="space-y-4">
              <div>
                <h2 id="done-heading" className="section-heading">Confirmed {factDate.format(current.confirmedAt!)}</h2>
                <p className="section-caption">
                  {current.representConsentAt ? `${firstName} agreed to be put forward to ${clientName}.` : `${firstName} has not agreed to be put forward yet.`}{" "}
                  {candidate.person && <Link href={`/people/${candidate.person.id}`} className="underline underline-offset-2">Open their record</Link>}
                </p>
              </div>
              <dl className="fact-grid">
                {FIELDS.map((field) => {
                  const shown = factSummary(field, summary.fields[field] as ConfirmedFact<FactField>);
                  return (
                    <div key={field} className="fact">
                      <dt>{FIELD_LABELS[field]}</dt>
                      <dd className={summary.fields[field].not_discussed ? "fact-empty" : ""}>{shown.value}</dd>
                      {shown.note && <dd className="fact-note">{shown.note}</dd>}
                    </div>
                  );
                })}
              </dl>

              {features.clientEmail && (
                <section aria-labelledby="client-email-heading" className="space-y-4 pt-6">
                  <div>
                    <h2 id="client-email-heading" className="section-heading">Email the client</h2>
                    <p className="section-caption">
                      Built from the facts above. Edit it, then send it from your own email; Capture does not send it.
                    </p>
                  </div>
                  {!current.representConsentAt ? (
                    <ActionForm action={recordRepresentConsent} className="screening-save">
                      <input type="hidden" name="screeningId" value={current.id} />
                      <p className="text-sm text-ink">
                        {firstName}&rsquo;s details go to {clientName} only once they have agreed. If they have said yes since the call, record it here.
                      </p>
                      <label className="screening-consent">
                        <input type="checkbox" name="agreed" className="screening-check" />
                        <span>{firstName} agreed to be put forward to {clientName}</span>
                      </label>
                      <div>
                        <SubmitButton className="btn-secondary" pendingLabel="Saving...">Record their agreement</SubmitButton>
                      </div>
                    </ActionForm>
                  ) : (
                    <>
                      <ClientEmailComposer
                        disabled={readOnly}
                        initialSubject={clientEmailSubject({ candidateName: candidate.fullName, roleTitle: candidate.role.title })}
                        initialBody={clientEmailBody({
                          candidateName: candidate.fullName,
                          roleTitle: candidate.role.title,
                          client: candidate.role.client,
                          recruiterName: settings?.recruiterName || "",
                          confirmedAt: current.confirmedAt!,
                          summary,
                          skillsSummary: candidate.person?.skillsSummary ?? null,
                          motivation: candidate.person?.motivation ?? null,
                        })}
                      />
                      {current.clientEmailSentAt ? (
                        <p className="client-email-sent text-sm text-ink" role="status">
                          <span className="chip screening-chip-done">Sent</span>
                          Marked as sent to the client on {factDate.format(current.clientEmailSentAt)}.
                        </p>
                      ) : (
                        <ActionForm action={markClientEmailSent} className="client-email-sent">
                          <input type="hidden" name="screeningId" value={current.id} />
                          <SubmitButton className="btn-secondary" pendingLabel="Saving...">Mark as sent</SubmitButton>
                          <p className="text-xs text-ink-soft">Once you have sent it. Moves {firstName} to Submitted.</p>
                        </ActionForm>
                      )}
                    </>
                  )}
                </section>
              )}

              <details className="screening-again">
                <summary className="btn-secondary">Add another screening</summary>
                <div className="mt-5">
                  <TranscriptForm candidateId={candidate.id} startOpen />
                </div>
              </details>
            </section>
          ) : (
            <section className="card space-y-3">
              <p className="text-sm text-ink">This screening could not be read.</p>
              <form action={discardScreening}>
                <input type="hidden" name="screeningId" value={current.id} />
                <ConfirmSubmitButton label="Discard it" confirmText="Discard this screening? This cannot be undone." />
              </form>
            </section>
          )}

          {transcript && current && current.status !== "draft" && (
            <details className="screening-transcript">
              <summary>Transcript</summary>
              <pre>{transcript}</pre>
            </details>
          )}
        </div>

        <aside aria-labelledby="about-heading" className="person-aside">
          <h2 id="about-heading" className="text-base font-semibold">About this screening</h2>
          {current?.transcriptDeleteAfter && transcript ? (
            <div className="space-y-3">
              <p className="text-sm text-ink-soft">
                The transcript is kept until {factDate.format(current.transcriptDeleteAfter)}, then deleted. What you confirm stays.
              </p>
              {!readOnly && (
                <form action={deleteTranscript}>
                  <input type="hidden" name="screeningId" value={current.id} />
                  <ConfirmSubmitButton label="Delete transcript now" confirmText="Delete this transcript now? The summary and anything you confirmed stay. This cannot be undone." />
                </form>
              )}
            </div>
          ) : current && current.transcriptSource ? (
            <p className="text-sm text-ink-soft">The transcript has been deleted. What you confirmed stays.</p>
          ) : (
            <p className="text-sm text-ink-soft">Transcripts are kept for 30 days, then deleted. What you confirm stays on their record.</p>
          )}
          <p className="border-t border-line pt-5 text-sm text-ink-soft">
            <span className="tabular text-ink">{used} of {cap}</span> summaries used this month.
          </p>
          {candidate.person && (
            <Link href={`/people/${candidate.person.id}`} className="btn-secondary w-full">Open {firstName}&rsquo;s record</Link>
          )}
        </aside>
      </div>
    </fieldset>
  );
}
