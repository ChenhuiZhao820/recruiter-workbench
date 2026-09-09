import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { createTemplate, deleteTemplate, updateTemplate } from "@/app/actions/templates";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { KNOWN_PLACEHOLDERS, isKnownPlaceholder, placeholderSplitPattern } from "@/lib/render";
import { templateKindLabel } from "@/lib/templates";
import { MessageBodyField } from "@/components/MessageBodyField";
import { ActionForm } from "@/components/ActionForm";

export const dynamic = "force-dynamic";

function BodyWithHighlights({ body }: { body: string }) {
  const parts = body.split(placeholderSplitPattern());
  return (
    <p className="whitespace-pre-wrap">
      {parts.map((part, i) =>
        isKnownPlaceholder(part) ? (
          <mark key={i} className="rounded bg-accent-soft/40 px-1 font-mono text-sm">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
}

export default async function TemplatesPage() {
  const { owner, readOnly } = await getWorkspace();
  const templates = await db.messageTemplate.findMany({ where: { userId: owner.id }, orderBy: { updatedAt: "desc" } });

  return (
    <fieldset key={owner.id} disabled={readOnly} className="min-w-0">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Outreach / Message library</p>
          <h1>Templates</h1>
          <p className="page-description">A thoughtful starting point for every conversation.</p>
        </div>
      </header>
      <p className="mb-8 max-w-3xl border-l-2 border-accent pl-4 text-sm leading-relaxed text-ink-soft">
        Write a message once, with gaps for the details. Available gaps:{" "}
        {KNOWN_PLACEHOLDERS.map((name, i) => (
          <span key={name}>
            {i > 0 ? ", " : ""}
            <code className="font-mono text-sm">{`{{${name}}}`}</code>
          </span>
        ))}
        . Anything else is left as a visible [UNKNOWN] gap.
      </p>

      <div className="grid items-start gap-8 xl:grid-cols-[1.2fr_1fr]">
      <section aria-label="Saved templates" className="min-w-0">
        <h2 className="section-heading mb-5"><span aria-hidden="true" className="section-number">01</span> Saved templates</h2>
      {templates.length === 0 && (
        <div className="card empty-state mb-4">
          <p className="text-xl font-medium text-ink">No templates yet.</p>
          <p className="mt-2 text-sm text-ink-soft">Create your first one below.</p>
        </div>
      )}

      <ul className="space-y-4">
        {templates.map((t) => (
          <li key={t.id} className="card">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg">{t.name}</h2>
              <span className="flex flex-wrap items-center gap-2">
                <span className="chip">{templateKindLabel(t.kind)}</span>
                <span className="font-mono text-xs tabular text-ink-soft">
                  {t.body.length} chars
                </span>
              </span>
            </div>
            <BodyWithHighlights body={t.body} />
            <div className="mt-3 flex flex-wrap gap-2">
              <form action={deleteTemplate}>
                <input type="hidden" name="id" value={t.id} />
                <ConfirmSubmitButton
                  label="Delete"
                  confirmText={`Delete the template "${t.name}"? This cannot be undone.`}
                />
              </form>
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-ink/70">Edit</summary>
              <ActionForm action={updateTemplate} className="mt-2 space-y-2">
                <input type="hidden" name="id" value={t.id} />
                <div>
                  <label htmlFor={`tname-${t.id}`} className="field-label">
                    Name
                  </label>
                  <input
                    id={`tname-${t.id}`}
                    name="name"
                    defaultValue={t.name}
                    required
                    className="field-input"
                  />
                </div>
                <MessageBodyField
                  idPrefix={`t-${t.id}`}
                  defaultKind={t.kind}
                  defaultBody={t.body}
                />
                <button type="submit" className="btn-secondary">
                  Save template
                </button>
              </ActionForm>
            </details>
          </li>
        ))}
      </ul>
      </section>

      <section className="min-w-0" aria-label="Create template">
        <h2 className="section-heading mb-5"><span aria-hidden="true" className="section-number">02</span> New template</h2>
        <ActionForm action={createTemplate} className="card form-panel space-y-6">
          <div>
            <label htmlFor="new-tname" className="field-label">
              Name
            </label>
            <input
              id="new-tname"
              name="name"
              required
              className="field-input"
              placeholder="First outreach"
            />
          </div>
          <MessageBodyField
            idPrefix="new-t"
            bodyId="new-tbody"
            placeholder={
              "Hi {{first_name}}, I'm hiring for a {{role_title}} and your background stood out. Open to a quick chat? You can grab a time here: {{calendar_link}}"
            }
          />
          <button type="submit" className="btn-primary">
            Create template
          </button>
        </ActionForm>
      </section>
      </div>
    </fieldset>
  );
}
