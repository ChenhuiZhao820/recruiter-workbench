import { loadBookingContext } from "@/lib/booking";
import { bookingIcs } from "@/lib/booking-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The candidate's calendar file, behind the same signed link as their page.
export async function GET(_request: Request, { params }: { params: { token: string } }) {
  const context = await loadBookingContext(params.token);
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  if (!context?.booking) return new Response("Not found", { status: 404, headers });
  const { booking, candidate, settings, owner } = context;
  const who = settings.recruiterName || owner.name;
  const how = booking.mode === "video" ? booking.meetingUrl ?? "" : `${who} will call you on ${booking.phone}`;
  const body = bookingIcs({
    uid: booking.id,
    start: booking.startsAt.getTime(),
    end: booking.endsAt.getTime(),
    summary: `Call with ${who}: ${candidate.role.title}`,
    description: how,
    location: booking.mode === "video" ? booking.meetingUrl ?? undefined : undefined,
  });
  return new Response(body, { headers: { ...headers, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="call.ics"' } });
}
