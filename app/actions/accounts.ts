"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { appOrigin, assertSameOrigin, getSession, requireAdmin } from "@/lib/auth";
import { hashToken, newSecret, normalizeEmail, validEmail } from "@/lib/auth-crypto";
import type { FormState } from "@/lib/formState";

export type AccountActionState = FormState & { activationUrl?: string };

export async function createAccount(_state: AccountActionState, form: FormData): Promise<AccountActionState> {
  assertSameOrigin();
  const admin = await requireAdmin();
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const name = String(form.get("name") ?? "").trim();
  if (!validEmail(email)) return { error: "Enter a valid email address." };
  if (!name || name.length > 120) return { error: "Enter a name of up to 120 characters." };
  const token = newSecret();
  try {
    await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, name, role: "recruiter" } });
      await tx.settings.create({ data: { userId: user.id, recruiterName: name } });
      await tx.activationToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 86400000) } });
      await tx.auditEvent.create({ data: { actorId: admin.id, targetUserId: user.id, action: "account_created" } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: "An account already uses this email address." };
    throw error;
  }
  revalidatePath("/admin");
  return { notice: "Account created. Share this one-time link privately; it expires in 24 hours and is shown only here.", activationUrl: `${appOrigin()}/activate#token=${token}` };
}

export async function issueActivation(_state: AccountActionState, form: FormData): Promise<AccountActionState> {
  assertSameOrigin();
  const admin = await requireAdmin();
  const userId = String(form.get("userId") ?? "");
  const token = newSecret();
  const issued = await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user?.active) return false;
    await tx.activationToken.deleteMany({ where: { userId } });
    await tx.activationToken.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 86400000) } });
    await tx.auditEvent.create({ data: { actorId: admin.id, targetUserId: userId, action: "activation_link_issued" } });
    return true;
  });
  if (!issued) return { error: "Enable this account before issuing a link." };
  return { notice: "Share this one-time password setup/reset link privately. It expires in 24 hours and replaces earlier links.", activationUrl: `${appOrigin()}/activate#token=${token}` };
}

export async function setAccountActive(_state: FormState, form: FormData): Promise<FormState> {
  assertSameOrigin();
  const admin = await requireAdmin();
  const userId = String(form.get("userId") ?? "");
  const active = form.get("active") === "true";
  if (userId === admin.id) return { error: "You cannot disable your own administrator account." };
  const changed = await db.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({ where: { id: userId, role: "recruiter" }, data: { active, authVersion: { increment: 1 } } });
    if (!updated.count) return false;
    await tx.session.deleteMany({ where: { userId } });
    await tx.activationToken.deleteMany({ where: { userId } });
    await tx.settings.updateMany({ where: { userId }, data: { captureTokenHash: null } });
    await tx.auditEvent.create({ data: { actorId: admin.id, targetUserId: userId, action: active ? "account_enabled" : "account_disabled" } });
    return true;
  });
  revalidatePath("/admin");
  return changed ? { notice: active ? "Account enabled. Issue a new activation link if needed." : "Account disabled. Sessions, activation links and capture keys have been revoked." } : { error: "This account cannot be changed here." };
}

export async function startViewing(form: FormData) {
  assertSameOrigin();
  const admin = await requireAdmin();
  const session = await getSession();
  if (!session) redirect("/login");
  const targetUserId = String(form.get("userId") ?? "");
  const target = await db.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
  if (!target) throw new Error("That account no longer exists.");
  await db.$transaction([
    db.session.update({ where: { tokenHash: session.tokenHash }, data: { viewUserId: targetUserId === admin.id ? null : targetUserId } }),
    db.auditEvent.create({ data: { actorId: admin.id, targetUserId, action: "workspace_view_started" } }),
  ]);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function stopViewing() {
  assertSameOrigin();
  const session = await getSession();
  if (!session) redirect("/login");
  await db.$transaction([
    db.session.update({ where: { tokenHash: session.tokenHash }, data: { viewUserId: null } }),
    db.auditEvent.create({ data: { actorId: session.userId, targetUserId: session.viewUserId, action: "workspace_view_ended" } }),
  ]);
  revalidatePath("/", "layout");
  redirect("/");
}
