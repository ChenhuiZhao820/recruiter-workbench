import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { appOrigin, getSession } from "@/lib/auth";
import { canUseFeature } from "@/lib/features";
import { calendarKey } from "@/lib/calendar-core.mjs";
import { readNotionState, safeReturn } from "@/lib/notion-core.mjs";
import { connectNotion } from "@/lib/notion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

// Notion sends the recruiter back here. The connection is kept only if the
// signed state names this signed-in account and has not expired; the code
// then becomes an encrypted token.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${appOrigin()}/login`, { status: 302, headers });
  const returnTo = safeReturn(cookies().get("capture_notion_return")?.value);
  const back = (outcome: "connected" | "declined" | "failed") => {
    const response = NextResponse.redirect(`${appOrigin()}${returnTo}?notion=${outcome}`, { status: 302, headers });
    response.cookies.delete({ name: "capture_notion_return", path: "/api/notion" });
    return response;
  };
  const url = new URL(request.url);
  const key = calendarKey();
  const state = key ? readNotionState(key, url.searchParams.get("state")) : null;
  if (!state || state.userId !== session.user.id) return back("failed");
  if (session.viewUserId && session.viewUserId !== session.user.id) return back("failed");
  if (!canUseFeature(session.user, "screening")) return back("failed");
  if (url.searchParams.get("error")) return back("declined");
  const code = url.searchParams.get("code");
  if (!code) return back("failed");
  try {
    await connectNotion(session.user.id, code);
    await db.auditEvent.create({ data: { actorId: session.user.id, targetUserId: session.user.id, action: "notion.connected" } });
    return back("connected");
  } catch {
    return back("failed");
  }
}
