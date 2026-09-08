import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { hashToken, newSecret } from "@/lib/auth-crypto";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "recruiter";
  active: boolean;
};

export const publicUserSelect = { id: true, email: true, name: true, role: true, active: true } as const;
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export function appOrigin(): string {
  const configured = process.env.APP_ORIGIN;
  if (!configured && process.env.NODE_ENV === "production") throw new Error("APP_ORIGIN must be configured before deployment.");
  const url = new URL(configured || "http://localhost:3000");
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("APP_ORIGIN must be an HTTPS origin, or an HTTP loopback origin for development.");
  }
  return url.origin;
}

function cookieName() {
  return appOrigin().startsWith("https:") ? "__Host-basanite_session" : "basanite_session";
}

export function assertSameOrigin() {
  const origin = headers().get("origin");
  if (origin !== appOrigin()) throw new Error("This request did not come from the workbench. Reload the page and try again.");
}

export async function getSession() {
  const token = cookies().get(cookieName())?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { ...publicUserSelect, authVersion: true } } },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.active || session.authVersion !== session.user.authVersion ||
      !["admin", "recruiter"].includes(session.user.role)) return null;
  return { ...session, user: session.user as SessionUser };
}

export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("Administrator access is required.");
  return user;
}

export async function createSession(userId: string, authVersion: number) {
  const token = newSecret();
  await db.session.create({
    data: { tokenHash: hashToken(token), userId, authVersion, expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) },
  });
  cookies().set(cookieName(), token, {
    httpOnly: true,
    secure: appOrigin().startsWith("https:"),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function endSession() {
  const token = cookies().get(cookieName())?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  cookies().set(cookieName(), "", {
    httpOnly: true,
    secure: appOrigin().startsWith("https:"),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function takeAuthAttempt(key: string, limit: number, seconds: number): Promise<boolean> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + seconds * 1000);
  if (key === "login:global") {
    await db.loginThrottle.deleteMany({ where: { resetAt: { lte: now } } });
    await db.session.deleteMany({ where: { expiresAt: { lte: now } } });
  }
  await db.loginThrottle.updateMany({ where: { key, resetAt: { lte: now } }, data: { attempts: 0, resetAt } });
  const bucket = await db.loginThrottle.upsert({
    where: { key },
    create: { key, attempts: 1, resetAt },
    update: { attempts: { increment: 1 } },
  });
  return bucket.attempts <= limit;
}
