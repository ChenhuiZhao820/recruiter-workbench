import { getSession } from "@/lib/auth";
import { canUseFeature } from "@/lib/features";
import { isPageId } from "@/lib/notion-core.mjs";
import { NotionNeedsReconnect, notionPageText } from "@/lib/notion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

// One Notion page as plain text, for the screening form's box. Nothing is
// stored here: the text goes to the page, where the recruiter sees it before
// summarising or saving.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first." }, { status: 401, headers });
  if (session.viewUserId && session.viewUserId !== session.user.id) return Response.json({ error: "Return to your own workspace first." }, { status: 403, headers });
  if (!canUseFeature(session.user, "screening")) return Response.json({ error: "Not found." }, { status: 404, headers });
  if (!isPageId(params.id)) return Response.json({ error: "Not found." }, { status: 404, headers });
  try {
    return Response.json(await notionPageText(session.user.id, params.id), { headers });
  } catch (error) {
    if (error instanceof NotionNeedsReconnect) return Response.json({ error: "Connect Notion again to import from it.", reconnect: true }, { status: 409, headers });
    return Response.json({ error: "That page could not be read from Notion. Try again, or copy it in by hand." }, { status: 502, headers });
  }
}
