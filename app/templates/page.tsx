import Link from "next/link";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { isKnownPlaceholder, placeholderSplitPattern } from "@/lib/render";
import { templateKindLabel } from "@/lib/templates";
import { TemplateRow } from "@/components/TemplateRow";

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
            <li key={t.id} className="card template-card">
              <TemplateRow id={t.id} name={t.name} kind={t.kind} kindLabel={templateKindLabel(t.kind)} body={t.body}>
                <BodyWithHighlights body={t.body} />
              </TemplateRow>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
