import Link from "next/link";
import { getWorkspace } from "@/lib/workspace";
import { createTemplate } from "@/app/actions/templates";
import { KNOWN_PLACEHOLDERS } from "@/lib/render";
import { MessageBodyField } from "@/components/MessageBodyField";
import { ActionForm } from "@/components/ActionForm";

export const dynamic = "force-dynamic";

// Writing a template is its own piece of work, so it gets its own page, the
// same way a role or a search does. The library stays a library.
export default async function NewTemplatePage() {
  const { owner, readOnly } = await getWorkspace();

  return (
    <fieldset key={owner.id} disabled={readOnly} className="min-w-0 max-w-3xl">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Templates / Create</p>
          <h1>New template</h1>
          <p className="page-description">Write it once, leave gaps for the details.</p>
        </div>
        <Link href="/templates" className="btn-quiet">
          Back to templates
        </Link>
      </header>

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
        {/* The gaps belong next to the box they are typed into, not on the
            library page where nobody is writing. */}
        <p className="text-sm text-ink-soft">
          Gaps this app fills in:{" "}
          {KNOWN_PLACEHOLDERS.map((name, i) => (
            <span key={name}>
              {i > 0 ? ", " : ""}
              <code className="font-mono text-sm">{`{{${name}}}`}</code>
            </span>
          ))}
          . Anything else stays visible as an [UNKNOWN] gap.
        </p>
        <button type="submit" className="btn-primary">
          Create template
        </button>
      </ActionForm>
    </fieldset>
  );
}
