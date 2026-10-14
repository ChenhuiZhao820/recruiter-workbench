import { getSession } from "@/lib/auth";
import { canUseFeature } from "@/lib/features";
import { NotionNeedsReconnect, searchNotionPages } from "@/lib/notion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

// The pages this account let Capture see in Notion, matching what was typed.
// The signed-in account's own connection only; never from a read-only view.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first." }, { status: 401, headers });
  if (session.viewUserId && session.viewUserId !== session.user.id) return Response.json({ error: "Return to your own workspace first." }, { status: 403, headers });
  if (!canUseFeature(session.user, "screening")) return Response.json({ error: "Not found." }, { status: 404, headers });
  try {
    const pages = await searchNotionPages(session.user.id, new URL(request.url).searchParams.get("q") ?? "");
    return Response.json({ pages }, { headers });
  } catch (error) {
    if (error instanceof NotionNeedsReconnect) return Response.json({ error: "Connect Notion again to import from it.", reconnect: true }, { status: 409, headers });
    return Response.json({ error: "Notion could not be reached. Try again in a moment." }, { status: 502, headers });
  }
}
