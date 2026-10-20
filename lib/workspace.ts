import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assertSameOrigin, getSession, publicUserSelect, type SessionUser } from "@/lib/auth";
import { hasPlan } from "@/lib/account-tiers";

// A workspace is read-only in two cases: an administrator viewing someone
// else's, and an account with no plan (a self-serve trial that ended without a
// subscription) looking at its own. The second keeps everything it saved in
// view, exportable and deletable, but changes nothing until a plan is chosen.
export type Workspace = { user: SessionUser; owner: SessionUser; readOnly: boolean; noPlan: boolean };

export async function getWorkspace(): Promise<Workspace> {
  const session = await getSession();
  if (!session) redirect("/login");
  const { user } = session;
  if (!session.viewUserId || session.viewUserId === user.id) {
    const noPlan = !hasPlan(user);
    return { user, owner: user, readOnly: noPlan, noPlan };
  }
  if (user.role !== "admin") throw new Error("Administrator access is required.");
  const owner = await db.user.findUnique({ where: { id: session.viewUserId }, select: publicUserSelect });
  if (!owner) notFound();
  return { user, owner: owner as SessionUser, readOnly: true, noPlan: false };
}

export const NO_PLAN_MESSAGE = "Your trial has ended. Choose a plan in Billing to keep working; everything you saved is still here.";

export async function requireWritableWorkspace(): Promise<SessionUser> {
  assertSameOrigin();
  const workspace = await getWorkspace();
  if (workspace.noPlan) throw new Error(NO_PLAN_MESSAGE);
  if (workspace.readOnly) throw new Error("This workspace is read-only. Return to your own workspace before making changes.");
  return workspace.user;
}

// The signed-in account acting on itself, plan or not: billing, the password,
// deleting the account. Never from an administrator's read-only view.
export async function requireOwnAccount(): Promise<SessionUser> {
  assertSameOrigin();
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.viewUserId && session.viewUserId !== session.user.id) {
    throw new Error("Return to your own workspace first.");
  }
  return session.user;
}
