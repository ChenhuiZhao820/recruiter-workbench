import Link from "next/link";
import { requireFeature } from "@/lib/feature-access";
import { PeopleImportForm } from "@/components/PeopleImportForm";
import { undoUntil } from "@/lib/people-import-fields.mjs";

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
        <PeopleImportForm until={undoUntil(new Date())} />
      )}
    </div>
  );
}
