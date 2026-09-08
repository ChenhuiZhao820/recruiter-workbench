import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assertSameOrigin, getSession, publicUserSelect, type SessionUser } from "@/lib/auth";

export async function getWorkspace(): Promise<{ user: SessionUser; owner: SessionUser; readOnly: boolean }> {
  const session = await getSession();
  if (!session) redirect("/login");
  const { user } = session;
  if (!session.viewUserId || session.viewUserId === user.id) return { user, owner: user, readOnly: false };
  if (user.role !== "admin") throw new Error("Administrator access is required.");
  const owner = await db.user.findUnique({ where: { id: session.viewUserId }, select: publicUserSelect });
  if (!owner) notFound();
  return { user, owner: owner as SessionUser, readOnly: true };
}

export async function requireWritableWorkspace(): Promise<SessionUser> {
  assertSameOrigin();
  const workspace = await getWorkspace();
  if (workspace.readOnly) throw new Error("This workspace is read-only. Return to your own workspace before making changes.");
  return workspace.user;
}
