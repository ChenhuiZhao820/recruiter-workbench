import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { canUseFeature } from "@/lib/features";
import { cvDisposition } from "@/lib/cv-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The recruiter's own look at a person's CV: the workspace on screen only, a
// read-only Admin view included. Never cached, never indexed.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": "frame-ancestors 'self'",
    "Vary": "Cookie",
  };
  if (!(await getSession())) return new Response("Sign in first.", { status: 401, headers });
  const { user, owner } = await getWorkspace();
  const now = new Date();
  if (!canUseFeature(user, "people", now) || !canUseFeature(owner, "people", now)) return new Response("Not found", { status: 404, headers });
  const cv = await db.personCv.findFirst({ where: { personId: params.id, person: { userId: owner.id } }, select: { data: true, fileName: true } });
  if (!cv) return new Response("Not found", { status: 404, headers });
  return new Response(new Uint8Array(cv.data), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": cvDisposition(cv.fileName) } });
}
