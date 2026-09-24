import Link from "next/link";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { deleteTemplate, updateTemplate } from "@/app/actions/templates";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { isKnownPlaceholder, placeholderSplitPattern } from "@/lib/render";
import { templateKindLabel } from "@/lib/templates";
import { MessageBodyField } from "@/components/MessageBodyField";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/Icon";

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
    <fieldset key={owner.id} disabled={readOnly} className="min-w-0 max-w-4xl">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Outreach / Message library</p>
          <h1>Templates</h1>
          <p className="page-description">A thoughtful starting point for every conversation.</p>
        </div>
        {!readOnly && (
          <Link href="/templates/new" className="btn-primary">
            New template
          </Link>
        )}
      </header>

      {templates.length === 0 ? (
        <div className="card empty-state">
          <p className="page-eyebrow">Your message library starts here</p>
          <p className="text-xl font-medium text-ink">No templates yet.</p>
          <p className="mt-2">
            Write a message once, leave gaps for the details, and it is ready for everyone you
            write to next.
          </p>
        </div>
      ) : (
        // One line per template until it is asked for: a library is read by its
        // spines, not by every page at once.
        <ul className="space-y-3">
          {templates.map((t) => (
            <li key={t.id}>
              <details className="group rounded border border-line bg-surface">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded p-4 hover:bg-sunken [&::-webkit-details-marker]:hidden">
                  <span className="flex flex-wrap items-center gap-3">
                    <span className="text-lg">{t.name}</span>
                    <span className="chip">{templateKindLabel(t.kind)}</span>
                  </span>
                  <Icon
                    name="down"
                    size={18}
                    className="shrink-0 text-ink/60 group-open:rotate-180 group-open:text-accent"
                  />
                </summary>
                <div className="space-y-3 px-4 pb-4">
                  <p className="font-mono text-xs tabular text-ink-soft">{t.body.length} chars</p>
                  <BodyWithHighlights body={t.body} />
                  <div className="flex flex-wrap gap-2">
                    <form action={deleteTemplate}>
                      <input type="hidden" name="id" value={t.id} />
                      <ConfirmSubmitButton
                        label="Delete"
                        confirmText={`Delete the template "${t.name}"? This cannot be undone.`}
                      />
                    </form>
                  </div>
                  <details>
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
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
