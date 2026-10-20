"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { appOrigin, assertSameOrigin, createSession, endSession, requireUser, takeAuthAttempt } from "@/lib/auth";
import { hashPassword, hashToken, newSecret, normalizeEmail, passwordError, validEmail, verifyPassword } from "@/lib/auth-crypto";
import { mailConfigured, sendMail } from "@/lib/mailer";
import { isNewAccount } from "@/lib/onboarding";
import { purgeExpiredTranscripts } from "@/lib/retention";
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
  // A workspace with nothing in it yet is almost always a first sign-in after
  // activation, so that visit starts on the setup guide instead of an empty
  // dashboard. Once anything has been configured, sign-in lands where it always did.
  const guided = await isNewAccount(user.id, user.role);
  await endSession();
  await createSession(user.id, user.authVersion);
  // Retention runs where the recruiter already is; a failure here must not
  // stop them signing in, and the screens hide an expired transcript anyway.
  await purgeExpiredTranscripts(user.id).catch(() => undefined);
  // A new release is never the first page: it waits on the bell and in
  // Notifications, with the top bar's What's new link, until it is read.
  redirect(guided ? "/getting-started" : "/");
}

export async function logout() {
  assertSameOrigin();
  await endSession();
  redirect("/login");
}

const RESET_MINUTES = 60;

// "Forgot password": the same one-time link an administrator can issue
// (/activate, the token in the fragment), sent to the account's own address
// and good for an hour. The answer never says whether the address has an
// account. Setting the password through it signs out every session and
// revokes the capture key, as activation always has.
export async function requestPasswordReset(_state: FormState, form: FormData): Promise<FormState> {
  assertSameOrigin();
  if (!mailConfigured()) return { error: "Password reset by email is not set up yet. Ask your administrator for a link." };
  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!validEmail(email)) return { error: "Enter a valid email address." };
  const address = headers().get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean).at(-1) ?? "local";
  if (!await takeAuthAttempt("reset:global", 60, 60) ||
      !await takeAuthAttempt(`reset:ip:${hashToken(address)}`, 10, 3600) ||
      !await takeAuthAttempt(`reset:email:${hashToken(email)}`, 3, 3600)) {
    return { error: "Too many reset requests. Wait a while before trying again." };
  }
  const sent = { notice: "If that address has a Retrivr account, a link to set a new password is on its way. It works for an hour." };
  const user = await db.user.findUnique({ where: { email }, select: { id: true, active: true, role: true } });
  if (!user?.active || !["admin", "recruiter"].includes(user.role)) return sent;
  const token = newSecret();
  await db.$transaction(async (tx) => {
    await tx.activationToken.deleteMany({ where: { userId: user.id } });
    await tx.activationToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) } });
    await tx.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "password_reset_requested" } });
  });
  try {
    await sendMail({
      to: email,
      subject: "Set a new Retrivr password",
      text: `Set a new password for Retrivr here:

${appOrigin()}/activate#token=${token}

The link works once, for an hour. Setting a password signs you out everywhere and stops your extension's capture key; generate a new one in Settings afterwards.

If you did not ask for this, ignore this email. Your password has not changed.`,
    });
  } catch {
    return { error: "We could not send the email just now. Try again in a minute." };
  }
  return sent;
}

export async function activateAccount(_state: FormState, form: FormData): Promise<FormState> {
  assertSameOrigin();
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const confirmation = String(form.get("confirmation") ?? "");
  const error = passwordError(password);
  if (error) return { error };
  if (password !== confirmation) return { error: "The two passwords do not match." };
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { error: "This link is invalid. Ask for a new one." };
  if (!await takeAuthAttempt("activation:global", 60, 60)) return { error: "Too many attempts. Please try again in a minute." };
  const tokenHash = hashToken(token);
  const activation = await db.activationToken.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!activation || activation.expiresAt <= new Date() || !activation.user.active) {
    return { error: "This link has expired, has already been used, or the account is disabled. Ask for a new one from Forgot password, or from your administrator." };
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
  if (!changed) return { error: "This link has already been used. Ask for a new one." };
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
