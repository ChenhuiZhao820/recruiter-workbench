import NewShortlistPage from "@/app/shortlists/new/page";
import { Overlay } from "@/components/Overlay";

// New shortlist, opened over the page it was started from. Visiting the
// address directly (or reloading) still gives the full page.
export default function NewShortlistOverlay({ searchParams }: { searchParams: Parameters<typeof NewShortlistPage>[0]["searchParams"] }) {
  return (
    <Overlay label="New shortlist">
      <NewShortlistPage searchParams={searchParams} />
    </Overlay>
  );
}
