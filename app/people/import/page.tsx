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
    <div className="min-w-0 max-w-3xl space-y-6">
      <header className="page-header">
        <div>
          <nav aria-label="Breadcrumb" className="page-eyebrow">
            <Link href="/people" className="hover:text-ink">People</Link> / <span aria-current="page">Import</span>
          </nav>
          <h1>Import people</h1>
          <p className="page-description">Bring in a list you already keep in Excel or a CSV file. You see exactly what will happen before anything is saved.</p>
        </div>
      </header>

      {readOnly ? (
        <p className="section-caption">Return to your own workspace to import people.</p>
      ) : (
        <>
          <PeopleImportForm />
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-soft">What is and is not imported</summary>
            <div className="mt-3 space-y-2 text-ink-soft">
              <p>Read from your file: {IMPORT_FIELDS.map((field: string) => FIELD_LABELS[field as keyof typeof FIELD_LABELS].toLowerCase()).join(", ")}.</p>
              <p>People are recognised by LinkedIn member id, then by profile link, and never by name, so two people who share a name stay apart. Nobody is contacted or looked up on LinkedIn, and the file itself is not kept.</p>
              <p>Salary, notice period and right to work are not imported: they count in search only once confirmed on a screening.</p>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
