import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { canUseFeature } from "@/lib/features";
import { loadPreview } from "@/lib/shortlists";
import { cvDisposition } from "@/lib/cv-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The CV as the preview shows it: the recruiter's own workspace (or the one a
// read-only Admin view is on), and only for someone the client's page would
// show right now. Never counted as the client looking.
export async function GET(_request: Request, { params }: { params: { id: string; itemId: string } }) {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": "frame-ancestors 'self'",
    "X-Frame-Options": "SAMEORIGIN",
    "Vary": "Cookie",
  };
  if (!(await getSession())) return new Response("Sign in first.", { status: 401, headers });
  const { user, owner } = await getWorkspace();
  const now = new Date();
  if (!canUseFeature(user, "clientShortlists", now) || !canUseFeature(owner, "clientShortlists", now)) return new Response("Not found", { status: 404, headers });
  const preview = await loadPreview(params.id, owner.id, now);
  if (!preview?.view.entries.some((entry) => entry.itemId === params.itemId && entry.cv)) return new Response("Not found", { status: 404, headers });
  const item = await db.shortlistItem.findFirst({
    where: { id: params.itemId, shortlistId: params.id, shortlist: { userId: owner.id } },
    select: { person: { select: { cv: { select: { data: true, fileName: true } } } } },
  });
  const cv = item?.person.cv;
  if (!cv) return new Response("Not found", { status: 404, headers });
  return new Response(new Uint8Array(cv.data), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": cvDisposition(cv.fileName) } });
}
