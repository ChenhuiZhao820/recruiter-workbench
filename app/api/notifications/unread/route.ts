import { getSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { unreadCount } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Vary": "Cookie" };

// The number on the bell, for the workspace on screen. Reads only: nothing is
// marked as read by asking how many there are.
export async function GET() {
  if (!(await getSession())) return Response.json({ error: "Sign in first." }, { status: 401, headers });
  const { owner } = await getWorkspace();
  return Response.json({ unread: await unreadCount(owner.id) }, { headers });
}
