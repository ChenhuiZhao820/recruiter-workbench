import { cookies } from "next/headers";
import { GATE_COOKIE, loadClientPage } from "@/lib/shortlists";
import { bookingIcs } from "@/lib/booking-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The client's calendar file for one interview on their page, behind the same
// signed link (and, for a named link, the same confirmed browser) as the page.
export async function GET(_request: Request, { params }: { params: { token: string; bookingId: string } }) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  const page = await loadClientPage(params.token, new Date(), cookies().get(GATE_COOKIE)?.value);
  const interview = page.state === "active" ? page.view.interviews.find((entry) => entry.bookingId === params.bookingId) : undefined;
  if (!interview) return new Response("Not found", { status: 404, headers });
  const body = bookingIcs({
    uid: interview.bookingId,
    start: interview.startsAt.getTime(),
    end: interview.endsAt.getTime(),
    summary: `Interview: ${interview.fullName} (${interview.roleTitle})`,
    description: interview.meetingUrl ?? interview.place ?? "",
    location: interview.meetingUrl ?? interview.place ?? undefined,
  });
  return new Response(body, { headers: { ...headers, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="interview.ics"' } });
}
