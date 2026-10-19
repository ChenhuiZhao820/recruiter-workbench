import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { GATE_COOKIE, loadClientPage } from "@/lib/shortlists";
import { cvDisposition } from "@/lib/cv-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// One person's CV, for the client, behind the same signed link (and, for a
// named link, the same confirmed browser) as their page, and only while that
// person is on it: anyone the page would no longer show has no CV here either.
// Read live, so a CV uploaded or replaced while the link is open is the one
// served. Framed only by this site's own page.
export async function GET(_request: Request, { params }: { params: { token: string; itemId: string } }) {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": "frame-ancestors 'self'",
    "X-Frame-Options": "SAMEORIGIN",
  };
  const page = await loadClientPage(params.token, new Date(), cookies().get(GATE_COOKIE)?.value);
  const entry = page.state === "active" ? page.view.entries.find((candidate) => candidate.itemId === params.itemId) : undefined;
  if (page.state !== "active" || !entry?.cv) return new Response("Not found", { status: 404, headers });
  const item = await db.shortlistItem.findFirst({
    where: { id: params.itemId, shortlistId: page.shortlistId, shortlist: { userId: page.ownerId } },
    select: { person: { select: { cv: { select: { data: true, fileName: true } } } } },
  });
  const cv = item?.person.cv;
  if (!cv) return new Response("Not found", { status: 404, headers });
  return new Response(new Uint8Array(cv.data), {
    headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": cvDisposition(cv.fileName) },
  });
}
