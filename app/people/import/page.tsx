import Link from "next/link";
import { requireFeature } from "@/lib/feature-access";
import { PeopleImportForm } from "@/components/PeopleImportForm";
import { FIELD_LABELS, IMPORT_FIELDS } from "@/lib/people-import-fields.mjs";

export const dynamic = "force-dynamic";

// Bringing a spreadsheet of people in. The file is read on the server for the
// length of one request and is never stored: what is kept is the people it
// describes, each with a note saying which file they came from.
export default async function ImportPeoplePage() {
  const { readOnly } = await requireFeature("peopleImport");
  return (
    <div className="min-w-0 max-w-4xl space-y-6">
      <header className="page-header">
        <div>
          <p className="page-eyebrow"><Link href="/people" className="hover:text-ink">People</Link> / Import</p>
          <h1>Import people</h1>
          <p className="page-description">Bring in a list you already keep in Excel or a CSV file. You see exactly what would happen before anything is saved.</p>
        </div>
      </header>

      <section aria-label="What can be imported" className="card space-y-2">
        <h2 className="text-lg">What is imported</h2>
        <p className="text-sm text-ink-soft">
          {IMPORT_FIELDS.map((field: string) => FIELD_LABELS[field as keyof typeof FIELD_LABELS]).join(", ")}.
        </p>
        <p className="section-caption">
          People are recognised by LinkedIn member id, then by profile link, and never by name, so two people who share a name are kept apart.
          Anyone you deleted before is skipped, nobody already in People is overwritten, and imported people are not contacted or looked up on LinkedIn.
          Salary, notice period and right to work are not imported: they count in search only once confirmed on a screening.
        </p>
      </section>

      {readOnly ? (
        <p className="section-caption">Return to your own workspace to import people.</p>
      ) : (
        <PeopleImportForm />
      )}
    </div>
  );
}
