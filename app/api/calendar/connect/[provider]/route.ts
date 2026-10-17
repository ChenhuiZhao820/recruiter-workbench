import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canUseFeature } from "@/lib/features";
import { authorizeUrl, calendarKey, providerCredentials, signState } from "@/lib/calendar-core.mjs";
import { redirectUri } from "@/lib/calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

// Starts connecting a calendar: the recruiter is sent to Google or Microsoft
// to agree to free/busy access, with a signed state naming who asked.
export async function GET(_request: Request, { params }: { params: { provider: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers });
  if (session.viewUserId && session.viewUserId !== session.user.id) return NextResponse.json({ error: "Return to your own workspace first." }, { status: 403, headers });
  if (!canUseFeature(session.user, "calendarFreeBusy")) return NextResponse.json({ error: "Not found." }, { status: 404, headers });
  const credentials = providerCredentials(params.provider);
  const key = calendarKey();
  if (!credentials || !key) return NextResponse.json({ error: "This calendar is not set up on this server." }, { status: 404, headers });
  const state = signState(key, session.user.id, params.provider);
  return NextResponse.redirect(authorizeUrl(params.provider, { clientId: credentials.clientId, redirectUri: redirectUri(params.provider), state }), { status: 302, headers });
}
