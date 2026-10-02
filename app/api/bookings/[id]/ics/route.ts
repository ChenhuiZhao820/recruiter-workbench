import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canUseFeature } from "@/lib/features";
import { bookingIcs } from "@/lib/booking-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Vary": "Cookie" };

// The recruiter's calendar file for a booked call, from their own workspace.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return new Response("Sign in first.", { status: 401, headers });
  if (session.viewUserId && session.viewUserId !== session.user.id) return new Response("Return to your own workspace first.", { status: 403, headers });
  if (!canUseFeature(session.user, "booking")) return new Response("Not found", { status: 404, headers });
  const booking = await db.booking.findFirst({
    where: { id: params.id, userId: session.user.id, status: "booked", candidate: { role: { userId: session.user.id } } },
    include: { candidate: { select: { fullName: true, role: { select: { title: true } } } } },
  });
  if (!booking) return new Response("Not found", { status: 404, headers });
  const how = booking.mode === "video" ? booking.meetingUrl ?? "" : `Call ${booking.candidate.fullName} on ${booking.phone}`;
  const body = bookingIcs({
    uid: booking.id,
    start: booking.startsAt.getTime(),
    end: booking.endsAt.getTime(),
    summary: `Screening call: ${booking.candidate.fullName} (${booking.candidate.role.title})`,
    description: how,
    location: booking.mode === "video" ? booking.meetingUrl ?? undefined : undefined,
  });
  return new Response(body, { headers: { ...headers, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="screening-call.ics"' } });
}
