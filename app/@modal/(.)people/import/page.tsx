import ImportPeoplePage from "@/app/people/import/page";
import { Overlay } from "@/components/Overlay";

// Import people, opened over the page it was started from. Visiting the
// address directly (or reloading) still gives the full page.
export default function ImportOverlay() {
  return (
    <Overlay label="Import people">
      <ImportPeoplePage />
    </Overlay>
  );
}
