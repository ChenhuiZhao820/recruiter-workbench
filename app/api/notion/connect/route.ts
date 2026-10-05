import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canUseFeature } from "@/lib/features";
import { calendarKey } from "@/lib/calendar-core.mjs";
import { authorizeUrl, notionCredentials, safeReturn, signNotionState, STATE_MINUTES } from "@/lib/notion-core.mjs";
import { notionRedirectUri } from "@/lib/notion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

// Starts connecting Notion: the recruiter is sent to Notion to choose which
// pages Capture may read, with a signed state naming who asked. Where to come
// back to is kept in a short-lived cookie, limited to this app's own pages.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers });
  if (session.viewUserId && session.viewUserId !== session.user.id) return NextResponse.json({ error: "Return to your own workspace first." }, { status: 403, headers });
  if (!canUseFeature(session.user, "screening")) return NextResponse.json({ error: "Not found." }, { status: 404, headers });
  const credentials = notionCredentials();
  const key = calendarKey();
  if (!credentials || !key) return NextResponse.json({ error: "Notion is not set up on this server." }, { status: 404, headers });
  const state = signNotionState(key, session.user.id);
  const response = NextResponse.redirect(authorizeUrl({ clientId: credentials.clientId, redirectUri: notionRedirectUri(), state }), { status: 302, headers });
  response.cookies.set("capture_notion_return", safeReturn(new URL(request.url).searchParams.get("return")), {
    httpOnly: true, sameSite: "lax", path: "/api/notion", maxAge: STATE_MINUTES * 60, secure: request.url.startsWith("https:"),
  });
  return response;
}
