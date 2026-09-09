import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { parseObjectArray, parseStringArray } from "@/lib/json";
import { STAGES, STAGE_LABELS } from "@/lib/stages";
import { formatWhen } from "@/lib/dates";
import { profileHref } from "@/lib/urls";
import { addCandidate, deleteCandidate, setCandidateStage, updateCandidate } from "@/app/actions/candidates";
import { deleteRole } from "@/app/actions/roles";
import { GenerateBriefingButton } from "@/components/GenerateBriefingButton";
import { StageBadge } from "@/components/StageBadge";
import { RunSearchButton } from "@/components/RunSearchButton";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { ActionForm } from "@/components/ActionForm";
import { OUTREACH_KIND_SUMMARY, isTemplateKind } from "@/lib/templates";

export const dynamic = "force-dynamic";

type Skill = { skill: string; real_vs_buzzword: string };
type Question = { question: string; strong_answer: string; weak_answer: string };

export default async function RolePage({ params }: { params: { id: string } }) {
  const { owner, readOnly } = await getWorkspace();
  const role = await db.role.findUnique({
    where: { id: params.id, userId: owner.id },
    include: {
      briefing: true,
      candidates: {
        orderBy: { lastActivityAt: "desc" },
        include: { outreach: { orderBy: { sentAt: "desc" }, take: 1 } },
      },
      searches: { where: { userId: owner.id }, orderBy: { updatedAt: "desc" } },
    },
  });
  if (!role) notFound();

  const briefing = role.briefing;
  const hasJobDesc = Boolean(role.jobDesc && role.jobDesc.trim());
  const skills = briefing ? parseObjectArray<Skill>(briefing.keySkills) : [];
  const questions = briefing ? parseObjectArray<Question>(briefing.firstCallQuestions) : [];
  const searchTitles = briefing ? parseStringArray(briefing.searchTitles) : [];
  const targetCompanies = briefing ? parseStringArray(briefing.targetCompanies) : [];

  const candidateCount = role.candidates.length;
  const searchCount = role.searches.length;
  const deleteWarning = [
    `Delete "${role.title}"?`,
    `This removes its briefing and ${candidateCount} ${candidateCount === 1 ? "candidate" : "candidates"}, along with their outreach history.`,
    searchCount > 0
      ? `Its ${searchCount} saved ${searchCount === 1 ? "search is" : "searches are"} kept, but ${searchCount === 1 ? "it moves" : "they move"} to Ungrouped on the Searches page.`
      : "",
    "This cannot be undone.",
  ]
    .filter(Boolean)
    .join(" ");

  const createSearchHref = briefing
    ? `/searches/new?roleId=${role.id}&titles=${encodeURIComponent(searchTitles.join(", "))}&companies=${encodeURIComponent(targetCompanies.join(", "))}&name=${encodeURIComponent(`${role.title} search`)}`
    : `/searches/new?roleId=${role.id}`;

  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-10">
      <header className="page-header">
        <div className="min-w-0 flex-1">
          <p className="page-eyebrow">Roles / Workspace</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1>{role.title}</h1>
            {role.status === "closed" && <span className="chip">Closed</span>}
          </div>
          {role.client && <p className="mt-1 text-ink/70">{role.client}</p>}
          {role.status === "closed" && (
            <p className="mt-2 text-sm text-ink/70">
              This role is closed, so it is hidden from Roles and its candidates are left
              out of Follow-ups.{" "}
              {!readOnly && <><Link href={`/roles/${role.id}/edit`} className="underline">
                Reopen it
              </Link>{" "}
              to bring them back.</>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {!readOnly && <Link href={`/roles/${role.id}/edit`} className="btn-quiet">
            Edit role
          </Link>}
          <form action={deleteRole}>
            <input type="hidden" name="id" value={role.id} />
            <ConfirmSubmitButton
              label="Delete role"
              confirmText={deleteWarning}
            />
          </form>
        </div>
      </header>

      {/* Briefing */}
      <section aria-labelledby="briefing-heading" className="workspace-section">
        <div className="mb-5">
          <h2 id="briefing-heading" className="section-heading">
            <span aria-hidden="true" className="section-number">01</span> Briefing
          </h2>
          <p className="section-caption">The role, translated into what matters.</p>
        </div>
        {!briefing ? (
          <div className="card space-y-3">
            <p className="text-ink/70">
              No briefing yet. Generate a one-page briefing from the job description: what
              this person does all day, the skills that matter, search terms, and
              first-call questions.
            </p>
            {!hasJobDesc && (
              <p className="text-sm text-ink/70">
                This role has no job description yet.{" "}
                <Link href={`/roles/${role.id}/edit`} className="underline">
                  Add one first
                </Link>
                .
              </p>
            )}
            <GenerateBriefingButton roleId={role.id} hasBriefing={false} hasJobDesc={hasJobDesc} />
          </div>
        ) : (
          <div className="card space-y-5">
            <div>
              <h3 className="mb-1 text-lg">What they do all day</h3>
              <p>{briefing.dayToDay}</p>
            </div>
            <div>
              <h3 className="mb-1 text-lg">Skills that matter</h3>
              <ul className="space-y-2">
                {skills.map((s, i) => (
                  <li key={i}>
                    <span className="font-medium">{s.skill}.</span>{" "}
                    <span className="text-ink/80">{s.real_vs_buzzword}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-lg">Also goes by</h3>
              <ul className="flex flex-wrap gap-2">
                {searchTitles.map((t, i) => (
                  <li key={i} className="chip">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-lg">Where they tend to work</h3>
              <ul className="flex flex-wrap gap-2">
                {targetCompanies.map((t, i) => (
                  <li key={i} className="chip">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-lg">Typical pay</h3>
              <p>{briefing.salaryRange}</p>
            </div>
            <div>
              <h3 className="mb-1 text-lg">First-call questions</h3>
              <ul className="space-y-3">
                {questions.map((q, i) => (
                  <li key={i} className="rounded border border-line bg-sunken p-3">
                    <p className="font-medium">{q.question}</p>
                    <p className="mt-1 text-sm">
                      <span className="font-mono text-xs uppercase tracking-wide">Strong:</span>{" "}
                      {q.strong_answer}
                    </p>
                    <p className="mt-1 text-sm">
                      <span className="font-mono text-xs uppercase tracking-wide">Vague:</span>{" "}
                      {q.weak_answer}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-sm text-ink/60">
              Pay and skills are estimates to sanity check, not facts.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {!readOnly && <Link href={createSearchHref} className="btn-primary">
                Create a search from this
              </Link>}
              <GenerateBriefingButton roleId={role.id} hasBriefing={true} hasJobDesc={hasJobDesc} />
            </div>
          </div>
        )}
      </section>

      {/* Candidates */}
      <section aria-labelledby="candidates-heading">
        <h2 id="candidates-heading" className="mb-3 text-2xl">
          Candidates
        </h2>
        {role.candidates.length === 0 && (
          <p className="mb-3 text-ink/70">
            No candidates yet. When you find someone on LinkedIn, paste their profile link and
            name below.
          </p>
        )}
        <div className="space-y-4">
          {STAGES.map((stage) => {
            const inStage = role.candidates.filter((c) => c.stage === stage);
            if (inStage.length === 0) return null;
            return (
              <div key={stage}>
                <h3 className="mb-2 font-mono text-sm uppercase tracking-wide text-ink/70">
                  {STAGE_LABELS[stage]} ({inStage.length})
                </h3>
                <ul className="space-y-2">
                  {inStage.map((c) => (
                    <li key={c.id} className="card">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-medium">{c.fullName}</span>
                          {c.headline && <span className="text-ink/70"> · {c.headline}</span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StageBadge stage={c.stage} />
                          {c.outreach[0] && (
                            <span className="text-sm text-ink/60">
                              {isTemplateKind(c.outreach[0].kind)
                                ? OUTREACH_KIND_SUMMARY[c.outreach[0].kind]
                                : "Sent"}{" "}
                              {formatWhen(c.outreach[0].sentAt)}
                            </span>
                          )}
                          <span className="text-sm text-ink/60">
                            last activity {formatWhen(c.lastActivityAt)}
                          </span>
                        </div>
                      </div>
                      {c.notes && <p className="mt-2 text-sm text-ink/80">{c.notes}</p>}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {profileHref(c.profileUrl) && (
                          <a
                            href={readOnly ? undefined : profileHref(c.profileUrl)!}
                            aria-disabled={readOnly}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-quiet"
                          >
                            Open profile
                          </a>
                        )}
                        <Link href={`/candidates/${c.id}/outreach`} className="btn-quiet">
                          Draft outreach
                        </Link>
                        <form action={setCandidateStage} className="flex items-center gap-1">
                          <input type="hidden" name="id" value={c.id} />
                          <label htmlFor={`stage-${c.id}`} className="sr-only">
                            Change stage for {c.fullName}
                          </label>
                          <select
                            id={`stage-${c.id}`}
                            name="stage"
                            defaultValue={c.stage}
                            className="rounded border border-line bg-white px-2 py-1 text-sm"
                          >
                            {STAGES.map((s) => (
                              <option key={s} value={s}>
                                {STAGE_LABELS[s]}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="btn-quiet">
                            Set stage
                          </button>
                        </form>
                        <form action={deleteCandidate}>
                          <input type="hidden" name="id" value={c.id} />
                          <ConfirmSubmitButton
                            label="Remove"
                            confirmText={`Remove ${c.fullName} from this role? This cannot be undone.`}
                          />
                        </form>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm text-ink/70">Edit details</summary>
                        <ActionForm action={updateCandidate} className="mt-2 space-y-2">
                          <input type="hidden" name="id" value={c.id} />
                          <div>
                            <label htmlFor={`name-${c.id}`} className="field-label">
                              Full name
                            </label>
                            <input
                              id={`name-${c.id}`}
                              name="fullName"
                              defaultValue={c.fullName}
                              required
                              className="field-input"
                            />
                          </div>
                          <div>
                            <label htmlFor={`url-${c.id}`} className="field-label">
                              Profile link
                            </label>
                            <input
                              id={`url-${c.id}`}
                              name="profileUrl"
                              defaultValue={c.profileUrl ?? ""}
                              className="field-input"
                            />
                          </div>
                          <div>
                            <label htmlFor={`headline-${c.id}`} className="field-label">
                              Headline
                            </label>
                            <input
                              id={`headline-${c.id}`}
                              name="headline"
                              defaultValue={c.headline ?? ""}
                              className="field-input"
                            />
                          </div>
                          <div>
                            <label htmlFor={`notes-${c.id}`} className="field-label">
                              Notes
                            </label>
                            <textarea
                              id={`notes-${c.id}`}
                              name="notes"
                              defaultValue={c.notes ?? ""}
                              rows={2}
                              className="field-input"
                            />
                          </div>
                          <button type="submit" className="btn-secondary">
                            Save changes
                          </button>
                        </ActionForm>
                      </details>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="card mt-4">
          <h3 className="mb-3 text-lg">Add candidate</h3>
          <ActionForm action={addCandidate} className="space-y-3">
            <input type="hidden" name="roleId" value={role.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="new-fullName" className="field-label">
                  Full name
                </label>
                <input id="new-fullName" name="fullName" required className="field-input" placeholder="Jane Smith" />
              </div>
              <div>
                <label htmlFor="new-profileUrl" className="field-label">
                  Profile link (paste it)
                </label>
                <input
                  id="new-profileUrl"
                  name="profileUrl"
                  className="field-input"
                  placeholder="https://www.linkedin.com/in/..."
                />
              </div>
            </div>
            <div>
              <label htmlFor="new-headline" className="field-label">
                Headline (optional)
              </label>
              <input id="new-headline" name="headline" className="field-input" placeholder="Ops Director at Acme" />
            </div>
            <div>
              <label htmlFor="new-notes" className="field-label">
                Notes (optional)
              </label>
              <textarea id="new-notes" name="notes" rows={2} className="field-input" />
            </div>
            <button type="submit" className="btn-primary">
              Add candidate
            </button>
          </ActionForm>
        </div>
      </section>

      {/* Searches for this role */}
      <section aria-labelledby="searches-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="searches-heading" className="text-2xl">
            Searches for this role
          </h2>
          {!readOnly && <Link href={`/searches/new?roleId=${role.id}`} className="btn-secondary">
            New search
          </Link>}
        </div>
        {role.searches.length === 0 ? (
          <p className="text-ink/70">
            No saved searches for this role yet. Save one so you never have to rebuild it from
            memory.
          </p>
        ) : (
          <ul className="space-y-3">
            {role.searches.map((s) => {
              const industries = parseStringArray(s.industries);
              const locations = parseStringArray(s.locations);
              const keywords = [s.keywords, ...parseStringArray(s.titles)].filter(Boolean).join(" ");
              return (
                <li key={s.id} className="card">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-sm text-ink/60">
                      {s.lastUsedAt ? `last run ${formatWhen(s.lastUsedAt)}` : "never run"}
                    </span>
                  </div>
                  {s.keywords && <p className="mt-1 text-sm text-ink/80">Keywords: {s.keywords}</p>}
                  {(industries.length > 0 || locations.length > 0 || s.filterNotes) && (
                    <div className="mt-2 text-sm">
                      <p className="font-mono text-xs uppercase tracking-wide text-ink/60">
                        Apply these filters in LinkedIn after it opens:
                      </p>
                      <ul className="mt-1 flex flex-wrap gap-2">
                        {locations.map((l, i) => (
                          <li key={`l-${i}`} className="chip">
                            Location: {l}
                          </li>
                        ))}
                        {industries.map((ind, i) => (
                          <li key={`i-${i}`} className="chip">
                            Industry: {ind}
                          </li>
                        ))}
                        {s.filterNotes && <li className="chip">{s.filterNotes}</li>}
                      </ul>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {readOnly ? <button type="button" className="btn-primary" disabled>Run search</button> : <RunSearchButton searchId={s.id} keywords={keywords} />}
                    <Link href={`/searches/${s.id}/edit`} className="btn-quiet">
                      {readOnly ? "View details" : "Edit"}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </fieldset>
  );
}
