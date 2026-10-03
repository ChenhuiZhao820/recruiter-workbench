import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appOrigin, getSession } from "@/lib/auth";
import { canUseFeature } from "@/lib/features";
import { calendarKey, readState } from "@/lib/calendar-core.mjs";
import { exchangeCode, saveConnection } from "@/lib/calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

function back(outcome: "connected" | "declined" | "failed") {
  return NextResponse.redirect(`${appOrigin()}/settings/booking?calendar=${outcome}`, { status: 302, headers });
}

// Google or Microsoft sends the recruiter back here. The connection is kept
// only if the signed state names this signed-in account and this provider,
// and has not expired; the code then becomes an encrypted refresh token.
export async function GET(request: Request, { params }: { params: { provider: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${appOrigin()}/login`, { status: 302, headers });
  const url = new URL(request.url);
  const key = calendarKey();
  const state = key ? readState(key, url.searchParams.get("state")) : null;
  if (!state || state.userId !== session.user.id || state.provider !== params.provider) return back("failed");
  if (session.viewUserId && session.viewUserId !== session.user.id) return back("failed");
  if (!canUseFeature(session.user, "calendarFreeBusy")) return back("failed");
  if (url.searchParams.get("error")) return back("declined");
  const code = url.searchParams.get("code");
  if (!code) return back("failed");
  try {
    const { refreshToken, scope } = await exchangeCode(params.provider, code);
    await saveConnection(session.user.id, params.provider, refreshToken, scope);
    await db.auditEvent.create({ data: { actorId: session.user.id, targetUserId: session.user.id, action: "calendar.connected" } });
    return back("connected");
  } catch {
    return back("failed");
  }
}
