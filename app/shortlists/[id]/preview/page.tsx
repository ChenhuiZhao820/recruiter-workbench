import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireFeature } from "@/lib/feature-access";
import { loadPreview } from "@/lib/shortlists";
import { ClientShortlist } from "@/components/ClientShortlist";

export const dynamic = "force-dynamic";

// What the client sees on their link right now, inside the app and without a
// token, so looking never counts as the client opening it. A read-only Admin
// view previews the workspace on screen, like every other page.
export default async function ShortlistPreviewPage({ params }: { params: { id: string } }) {
  const { owner } = await requireFeature("clientShortlists");
  const preview = await loadPreview(params.id, owner.id);
  if (!preview) notFound();
  const shortlist = await db.shortlist.findUniqueOrThrow({ where: { id: params.id }, select: { roleId: true, client: true } });
  const back = shortlist.roleId ? `/roles/${shortlist.roleId}` : `/shortlists?open=${params.id}#shortlist-${params.id}`;
  return (
    <div className="space-y-2">
      <div role="status" className="client-preview-bar">
        <p>
          {preview.status === "active"
            ? <>This is what {shortlist.client || "the client"} sees on their link. Opening it here is not counted as them reading it.</>
            : <>This link is {preview.status}, so {shortlist.client || "the client"} sees only that it is no longer active. This is what was on it.</>}
        </p>
        <Link href={back} className="btn-quiet">{shortlist.roleId ? "Back to the role" : "Back to shortlists"}</Link>
      </div>
      <ClientShortlist view={preview.view} token={null} previewOf={params.id} />
    </div>
  );
}
