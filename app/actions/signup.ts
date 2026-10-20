"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { appOrigin, assertSameOrigin, getSession, takeAuthAttempt } from "@/lib/auth";
import { hashPassword, hashToken, normalizeEmail, passwordError, validEmail } from "@/lib/auth-crypto";
import { getAuth } from "@/lib/better-auth";
import { sendMail } from "@/lib/mailer";
import { signupConfig } from "@/lib/signup-config";
import { PENDING_MINUTES, TERMS_COOKIE, isDisposableEmail, isSignupCode, signTermsCookie, signupName } from "@/lib/signup-core.mjs";
import type { FormState } from "@/lib/formState";

// Self-serve sign-up by email: the details are held as a PendingSignup, a
// six-digit code goes to the address, and the account exists only once the
// code comes back (lib/better-auth.ts creates it from the pending row). The
// address being worked on travels in a short-lived HttpOnly cookie, never in
// the page address.
const EMAIL_COOKIE = "capture_signup_email";

function secure() {
  return appOrigin().startsWith("https:");
}

// Render appends the connecting address, so the last entry is the one a
// client cannot choose.
function clientAddress(): string {
  const forwarded = headers().get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean) ?? [];
  return forwarded.at(-1) ?? "local";
}

async function throttled(email: string | null): Promise<boolean> {
  if (!await takeAuthAttempt("signup:global", 60, 60)) return true;
  if (!await takeAuthAttempt(`signup:ip:${hashToken(clientAddress())}`, 10, 3600)) return true;
  return email !== null && !await takeAuthAttempt(`signup:email:${hashToken(email)}`, 5, 3600);
}

function signupEmail(): string | null {
  const value = normalizeEmail(cookies().get(EMAIL_COOKIE)?.value ?? "");
  return validEmail(value) ? value : null;
}

async function sendCode(email: string) {
  await getAuth().api.sendVerificationOTP({ body: { email, type: "sign-in" } });
}

export async function startSignup(_state: FormState, form: FormData): Promise<FormState> {
  assertSameOrigin();
  const config = signupConfig();
  if (!config.email) return { error: "Signing up by email is not open yet." };
  if (await getSession()) redirect("/");
  const name = signupName(form.get("name"));
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const password = String(form.get("password") ?? "");
  if (!name) return { error: "Enter your name, up to 120 characters." };
  if (!validEmail(email)) return { error: "Enter a valid email address." };
  if (isDisposableEmail(email)) return { error: "Use an email address you will keep. Throwaway inboxes cannot sign up." };
  const weak = passwordError(password);
  if (weak) return { error: weak };
  if (form.get("terms") !== "on") return { error: "Agree to the terms and privacy policy to create an account." };
  if (await throttled(email)) return { error: "Too many sign-up attempts. Wait a while before trying again." };

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  try {
    if (existing) {
      // Same answer either way, so the page does not tell anyone which
      // addresses have accounts; the inbox does.
      await sendMail({
        to: email,
        subject: "You already have a Retrivr account",
        text: `Someone, probably you, tried to sign up to Retrivr with this address. It already has an account.\n\nSign in: ${appOrigin()}/login\nForgot your password: ${appOrigin()}/forgot-password\n\nIf this was not you, there is nothing to do.`,
      });
    } else {
      const passwordHash = await hashPassword(password);
      const expiresAt = new Date(Date.now() + PENDING_MINUTES * 60_000);
      await db.pendingSignup.upsert({
        where: { email },
        create: { email, name, passwordHash, termsVersion: config.termsVersion, expiresAt },
        update: { name, passwordHash, termsVersion: config.termsVersion, expiresAt, createdAt: new Date() },
      });
      await sendCode(email);
    }
  } catch {
    return { error: "We could not send the email just now. Try again in a minute." };
  }
  cookies().set(EMAIL_COOKIE, email, { httpOnly: true, secure: secure(), sameSite: "lax", path: "/signup", maxAge: PENDING_MINUTES * 60 });
  redirect("/signup/verify");
}

export async function verifySignup(_state: FormState, form: FormData): Promise<FormState> {
  assertSameOrigin();
  const email = signupEmail();
  if (!email) return { error: "Start again: the sign-up has expired." };
  const code = String(form.get("code") ?? "").trim();
  if (!isSignupCode(code)) return { error: "Enter the six-digit code from the email." };
  if (!await takeAuthAttempt(`signup:verify:${hashToken(email)}`, 10, 900)) return { error: "Too many tries. Wait a few minutes, then ask for a new code." };
  const [pending, existing] = await Promise.all([
    db.pendingSignup.findUnique({ where: { email } }),
    db.user.findUnique({ where: { email }, select: { id: true } }),
  ]);
  if (!pending || pending.expiresAt <= new Date() || existing) return { error: "That code is wrong or has expired. Ask for a new one." };
  try {
    await getAuth().api.signInEmailOTP({ body: { email, otp: code }, headers: headers() });
  } catch {
    return { error: "That code is wrong or has expired. Ask for a new one." };
  }
  cookies().set(EMAIL_COOKIE, "", { httpOnly: true, secure: secure(), sameSite: "lax", path: "/signup", maxAge: 0 });
  redirect("/getting-started");
}

export async function resendSignupCode(): Promise<FormState> {
  assertSameOrigin();
  const email = signupEmail();
  if (!email) return { error: "Start again: the sign-up has expired." };
  if (await throttled(email)) return { error: "Too many codes asked for. Wait a while before trying again." };
  const pending = await db.pendingSignup.findUnique({ where: { email } });
  if (pending && pending.expiresAt > new Date()) {
    try {
      await sendCode(email);
    } catch {
      return { error: "We could not send the email just now. Try again in a minute." };
    }
  }
  return { notice: "A new code is on its way. The last one no longer works." };
}

// Before a Google or Microsoft sign-up leaves for the provider: the terms are
// agreed here, in a signed cookie that the account creation checks for on the
// way back. Signing in to an existing account does not need it.
export async function acceptTermsForProvider(accepted: boolean): Promise<FormState> {
  assertSameOrigin();
  const config = signupConfig();
  if (!config.google && !config.microsoft) return { error: "Signing up with Google or Microsoft is not open yet." };
  if (!accepted) return { error: "Agree to the terms and privacy policy to create an account." };
  if (await throttled(null)) return { error: "Too many sign-up attempts. Wait a while before trying again." };
  cookies().set(TERMS_COOKIE, signTermsCookie(config.termsVersion, process.env.BETTER_AUTH_SECRET ?? ""), {
    httpOnly: true, secure: secure(), sameSite: "lax", path: "/api/auth", maxAge: 15 * 60,
  });
  return {};
}
