"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { assertSameOrigin, createSession, endSession, requireUser, takeAuthAttempt } from "@/lib/auth";
import { hashPassword, hashToken, normalizeEmail, passwordError, validEmail, verifyPassword } from "@/lib/auth-crypto";
import type { FormState } from "@/lib/formState";

export async function login(_state: FormState, form: FormData): Promise<FormState> {
  assertSameOrigin();
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const password = String(form.get("password") ?? "");
  if (!validEmail(email) || !password || password.length > 128) return { error: "Email or password is incorrect, or this account is unavailable." };
  if (!await takeAuthAttempt("login:global", 120, 60) ||
      !await takeAuthAttempt(`login:${hashToken(email)}`, 10, 900)) {
    return { error: "Too many sign-in attempts. Wait a few minutes before trying again." };
  }
  const user = await db.user.findUnique({ where: { email } });
  const valid = await verifyPassword(password, user?.passwordHash ?? null);
  if (!valid || !user?.active || !["admin", "recruiter"].includes(user.role)) {
    return { error: "Email or password is incorrect, or this account is unavailable." };
  }
  await endSession();
  await createSession(user.id, user.authVersion);
  redirect("/");
}

export async function logout() {
  assertSameOrigin();
  await endSession();
  redirect("/login");
}

export async function activateAccount(_state: FormState, form: FormData): Promise<FormState> {
  assertSameOrigin();
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const confirmation = String(form.get("confirmation") ?? "");
  const error = passwordError(password);
  if (error) return { error };
  if (password !== confirmation) return { error: "The two passwords do not match." };
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { error: "This activation link is invalid. Ask your administrator for a new one." };
  if (!await takeAuthAttempt("activation:global", 60, 60)) return { error: "Too many attempts. Please try again in a minute." };
  const tokenHash = hashToken(token);
  const activation = await db.activationToken.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!activation || activation.expiresAt <= new Date() || !activation.user.active) {
    return { error: "This link has expired, has already been used, or the account is disabled. Ask your administrator for a new link." };
  }
  const passwordHash = await hashPassword(password);
  const changed = await db.$transaction(async (tx) => {
    const consumed = await tx.activationToken.deleteMany({
      where: { tokenHash, expiresAt: { gt: new Date() }, user: { active: true } },
    });
    if (!consumed.count) return false;
    await tx.user.update({ where: { id: activation.userId }, data: { passwordHash, authVersion: { increment: 1 } } });
    await tx.session.deleteMany({ where: { userId: activation.userId } });
    await tx.activationToken.deleteMany({ where: { userId: activation.userId } });
    await tx.settings.updateMany({ where: { userId: activation.userId }, data: { captureTokenHash: null } });
    await tx.auditEvent.create({ data: { actorId: activation.userId, targetUserId: activation.userId, action: "password_set" } });
    return true;
  });
  if (!changed) return { error: "This link has already been used. Ask your administrator for a new one." };
  await endSession();
  redirect("/login?activated=1");
}

export async function changePassword(_state: FormState, form: FormData): Promise<FormState> {
  assertSameOrigin();
  const current = await requireUser();
  const oldPassword = String(form.get("currentPassword") ?? "");
  const password = String(form.get("password") ?? "");
  const confirmation = String(form.get("confirmation") ?? "");
  const error = passwordError(password);
  if (error) return { error };
  if (password !== confirmation) return { error: "The two passwords do not match." };
  if (!await takeAuthAttempt(`password:${current.id}`, 10, 900)) return { error: "Too many attempts. Wait before trying again." };
  const user = await db.user.findUnique({ where: { id: current.id } });
  if (!user || !await verifyPassword(oldPassword, user.passwordHash)) return { error: "The current password is incorrect." };
  const passwordHash = await hashPassword(password);
  const changed = await db.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({ where: { id: current.id, active: true, passwordHash: user.passwordHash }, data: { passwordHash, authVersion: { increment: 1 } } });
    if (!updated.count) return false;
    await tx.session.deleteMany({ where: { userId: current.id } });
    await tx.activationToken.deleteMany({ where: { userId: current.id } });
    await tx.settings.updateMany({ where: { userId: current.id }, data: { captureTokenHash: null } });
    await tx.auditEvent.create({ data: { actorId: current.id, targetUserId: current.id, action: "password_changed" } });
    return true;
  });
  if (!changed) return { error: "Your account changed. Sign in again before retrying." };
  await endSession();
  redirect("/login?changed=1");
}
