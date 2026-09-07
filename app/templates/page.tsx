import { db } from "@/lib/db";
import { createTemplate, deleteTemplate, updateTemplate } from "@/app/actions/templates";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { KNOWN_PLACEHOLDERS, isKnownPlaceholder, placeholderSplitPattern } from "@/lib/render";
import { ActionForm } from "@/components/ActionForm";

export const dynamic = "force-dynamic";

function BodyWithHighlights({ body }: { body: string }) {
  const parts = body.split(placeholderSplitPattern());
  return (
    <p className="whitespace-pre-wrap">
      {parts.map((part, i) =>
        isKnownPlaceholder(part) ? (
          <mark key={i} className="rounded bg-brass-lite/40 px-1 font-mono text-sm">
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
  const templates = await db.messageTemplate.findMany({ orderBy: { updatedAt: "desc" } });

  return (
    <div className="max-w-3xl">
      <h1 className="mb-2 text-3xl">Templates</h1>
      <p className="mb-6 text-ink/70">
        Write a message once, with gaps for the details. Available gaps:{" "}
        {KNOWN_PLACEHOLDERS.map((name, i) => (
          <span key={name}>
            {i > 0 ? ", " : ""}
            <code className="font-mono text-sm">{`{{${name}}}`}</code>
          </span>
        ))}
        . Anything else is left as a visible [UNKNOWN] gap.
      </p>

      {templates.length === 0 && (
        <div className="card mb-4 text-ink/70">
          <p>No templates yet. Create your first one below.</p>
        </div>
      )}

      <ul className="space-y-3">
        {templates.map((t) => (
          <li key={t.id} className="card">
            <h2 className="mb-2 text-lg">{t.name}</h2>
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
                <div>
                  <label htmlFor={`tbody-${t.id}`} className="field-label">
                    Message
                  </label>
                  <textarea
                    id={`tbody-${t.id}`}
                    name="body"
                    defaultValue={t.body}
                    required
                    rows={6}
                    className="field-input"
                  />
                </div>
                <button type="submit" className="btn-secondary">
                  Save template
                </button>
              </ActionForm>
            </details>
          </li>
        ))}
      </ul>

      <div className="card mt-6">
        <h2 className="mb-3 text-lg">New template</h2>
        <ActionForm action={createTemplate} className="space-y-3">
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
          <div>
            <label htmlFor="new-tbody" className="field-label">
              Message
            </label>
            <textarea
              id="new-tbody"
              name="body"
              required
              rows={6}
              className="field-input"
              placeholder={
                "Hi {{first_name}}, I'm hiring for a {{role_title}} and your background stood out. Open to a quick chat? You can grab a time here: {{calendar_link}}"
              }
            />
          </div>
          <button type="submit" className="btn-primary">
            Create template
          </button>
        </ActionForm>
      </div>
    </div>
  );
}
