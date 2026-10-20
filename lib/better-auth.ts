import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins/email-otp";
import { db } from "@/lib/db";
import { appOrigin, issueSessionToken, revokeSessionToken, sessionCookieName, sessionCookieOptions } from "@/lib/auth";
import { trialEndsAt } from "@/lib/account-tiers";
import { sendMail } from "@/lib/mailer";
import { CURRENT_RELEASE } from "@/lib/release";
import { purgeExpiredTranscripts } from "@/lib/retention";
import { CODE_MINUTES, TERMS_COOKIE, cookieValue, isDisposableEmail, readTermsCookie, trialKeyForEmail } from "@/lib/signup-core.mjs";

// Better Auth proves who someone is and nothing more: an emailed sign-up code
// (the email-otp plugin, called only from app/actions/signup.ts), or Google or
// Microsoft. The moment it has made a session of its own, the hook below
// deletes it and issues the workbench's session instead (lib/auth.ts), so the
// hashed session table, its cookie, authVersion revocation and the read-only
// admin view stay exactly as they were. Passwords also stay where they were,
// on User.passwordHash, checked by app/actions/auth.ts.
//
// A new account is created here only for a sign-up: after a valid code for an
// address with a pending sign-up, or after Google or Microsoft vouched for the
// address and the person accepted the terms on /signup. It is always a
// recruiter, never an admin, and gets the seven-day Pro trial unless that
// address has had one.

export function betterAuthConfigured(): boolean {
  return (process.env.BETTER_AUTH_SECRET?.length ?? 0) >= 32;
}

export function googleSignInConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function microsoftSignInConfigured(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

type HookContext = { path?: string; headers?: Headers; request?: Request } | null | undefined;

async function newAccountFields(user: { email: string; emailVerified: boolean }, ctx: HookContext) {
  const email = user.email.toLowerCase();
  const claimed = await db.trialClaim.findUnique({ where: { keyHash: trialKeyForEmail(email) } });
  const trial = { accountTier: "trial", trialExpiresAt: claimed ? null : trialEndsAt(), signupSource: "self" };
  if (ctx?.path === "/sign-in/email-otp") {
    const pending = await db.pendingSignup.findUnique({ where: { email } });
    if (!pending || pending.expiresAt <= new Date()) return null;
    return { ...trial, name: pending.name, passwordHash: pending.passwordHash, termsVersion: pending.termsVersion, termsAcceptedAt: pending.createdAt };
  }
  if (ctx?.path?.startsWith("/callback/")) {
    // A provider that did not vouch for the address cannot claim it: in a
    // multi-tenant Microsoft app the email claim is whatever the tenant says.
    if (!user.emailVerified || isDisposableEmail(email)) return null;
    const header = ctx.headers?.get("cookie") ?? ctx.request?.headers.get("cookie");
    const terms = readTermsCookie(cookieValue(header, TERMS_COOKIE), process.env.BETTER_AUTH_SECRET ?? "");
    if (!terms) return null;
    return { ...trial, termsVersion: terms.version, termsAcceptedAt: terms.acceptedAt };
  }
  return null;
}

function createAuth() {
  const origin = appOrigin();
  const socialProviders: Record<string, unknown> = {};
  if (googleSignInConfigured()) {
    socialProviders.google = { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, prompt: "select_account" };
  }
  if (microsoftSignInConfigured()) {
    socialProviders.microsoft = { clientId: process.env.MICROSOFT_CLIENT_ID!, clientSecret: process.env.MICROSOFT_CLIENT_SECRET!, tenantId: "common", disableProfilePhoto: true, prompt: "select_account" };
  }
  return betterAuth({
    appName: "Retrivr",
    baseURL: origin,
    basePath: "/api/auth",
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [origin],
    database: prismaAdapter(db, { provider: (process.env.DATABASE_URL ?? "").startsWith("file:") ? "sqlite" : "postgresql" }),
    emailAndPassword: { enabled: false },
    socialProviders,
    user: {
      additionalFields: {
        signupSource: { type: "string", required: false, input: false },
        accountTier: { type: "string", required: false, input: false },
        trialExpiresAt: { type: "date", required: false, input: false },
        termsVersion: { type: "string", required: false, input: false },
        termsAcceptedAt: { type: "date", required: false, input: false },
        passwordHash: { type: "string", required: false, input: false, returned: false },
      },
    },
    session: { modelName: "authSession", expiresIn: 300 },
    account: {
      modelName: "authAccount",
      // Linked by email only when the provider says it verified the address.
      accountLinking: { enabled: true, trustedProviders: [] },
      storeAccountCookie: false,
    },
    verification: { modelName: "authVerification" },
    advanced: { cookiePrefix: "retrivr_auth", useSecureCookies: origin.startsWith("https:") },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            const fields = await newAccountFields(user, ctx as HookContext);
            return fields ? { data: { ...user, ...fields } } : false;
          },
          after: async (user) => {
            const name = String(user.name ?? "").trim();
            await db.$transaction([
              db.trialClaim.upsert({ where: { keyHash: trialKeyForEmail(user.email) }, create: { keyHash: trialKeyForEmail(user.email) }, update: {} }),
              db.pendingSignup.deleteMany({ where: { email: user.email.toLowerCase() } }),
              db.settings.upsert({ where: { userId: user.id }, create: { userId: user.id, recruiterName: name, seenRelease: CURRENT_RELEASE }, update: {} }),
              db.auditEvent.create({ data: { actorId: user.id, targetUserId: user.id, action: "account_signed_up" } }),
            ]);
          },
        },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const created = ctx.context.newSession;
        if (!created) return;
        // Better Auth's own session never outlives this request.
        await ctx.context.internalAdapter.deleteSession(created.session.token);
        deleteSessionCookie(ctx);
        const user = await db.user.findUnique({ where: { id: created.user.id }, select: { id: true, active: true, role: true, authVersion: true } });
        if (!user?.active || !["admin", "recruiter"].includes(user.role)) throw ctx.redirect("/login?error=unavailable");
        await revokeSessionToken(ctx.getCookie(sessionCookieName()));
        ctx.setCookie(sessionCookieName(), await issueSessionToken(user.id, user.authVersion), sessionCookieOptions());
        await purgeExpiredTranscripts(user.id).catch(() => undefined);
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: CODE_MINUTES * 60,
        allowedAttempts: 5,
        storeOTP: "hashed",
        async sendVerificationOTP({ email, otp }) {
          await sendMail({
            to: email,
            subject: `${otp} is your Retrivr code`,
            text: `Your Retrivr sign-up code is ${otp}.\n\nIt works for ${CODE_MINUTES} minutes. If you did not ask for it, ignore this email; no account is made without it.`,
          });
        },
      }),
      // Last, so cookies set by calls from server actions reach the browser.
      nextCookies(),
    ],
  });
}

let instance: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
  if (!betterAuthConfigured()) throw new Error("Sign-up is not set up on this server.");
  instance ??= createAuth();
  return instance;
}
