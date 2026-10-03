import { db } from "./db";
import { appOrigin } from "./auth";
import {
  PROVIDERS,
  PROVIDER_TIMEOUT_MS,
  calendarKey,
  decryptToken,
  encryptToken,
  endpoints,
  googleBusy,
  microsoftBusy,
  providerCredentials,
} from "./calendar-core.mjs";

// Server side of the calendar connection. Requests go from this server to the
// provider only, never from a browser, each with a three-second limit: a slow
// or failing calendar must never stop a candidate seeing the booking page.

export type Busy = { start: number; end: number };

export function redirectUri(provider: string) {
  return `${appOrigin()}/api/calendar/callback/${provider}`;
}

export function configuredProviders(): string[] {
  return PROVIDERS.filter((provider: string) => providerCredentials(provider));
}

async function timed(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: "error", cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

async function tokenRequest(provider: string, form: Record<string, string>) {
  const credentials = providerCredentials(provider);
  if (!credentials) throw new Error("Calendar provider is not configured.");
  const response = await timed(endpoints(provider).token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...form, client_id: credentials.clientId, client_secret: credentials.clientSecret }),
  });
  if (!response.ok) throw new Error(`Token request failed (${response.status}).`);
  return response.json() as Promise<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }>;
}

// The code from the provider's redirect becomes a refresh token, kept
// encrypted. Without a refresh token there is nothing to keep.
export async function exchangeCode(provider: string, code: string) {
  const body = await tokenRequest(provider, { grant_type: "authorization_code", code, redirect_uri: redirectUri(provider) });
  if (!body.refresh_token) throw new Error("The provider did not return a long-lived token.");
  return { refreshToken: body.refresh_token, accessToken: body.access_token, expiresIn: body.expires_in, scope: body.scope ?? "" };
}

// Access tokens live in memory only, for as long as the provider says.
const accessTokens = new Map<string, { token: string; expires: number }>();

async function accessToken(userId: string, provider: string, refreshToken: string) {
  const cached = accessTokens.get(userId);
  if (cached && cached.expires > Date.now() + 30_000) return cached.token;
  const body = await tokenRequest(provider, { grant_type: "refresh_token", refresh_token: refreshToken });
  if (!body.access_token) throw new Error("No access token.");
  accessTokens.set(userId, { token: body.access_token, expires: Date.now() + (body.expires_in ?? 3000) * 1000 });
  return body.access_token;
}

export function forgetAccessToken(userId: string) {
  accessTokens.delete(userId);
}

async function fetchBusy(provider: string, token: string, from: Date, to: Date): Promise<Busy[]> {
  const url = endpoints(provider).busy;
  if (provider === "google") {
    const response = await timed(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] }),
    });
    if (!response.ok) throw new Error(`Busy request failed (${response.status}).`);
    const busy = googleBusy(await response.json());
    if (!busy) throw new Error("Unreadable busy reply.");
    return busy;
  }
  const busy: Busy[] = [];
  let next: string | null = `${url}?${new URLSearchParams({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), $select: "start,end,showAs", $top: "200" })}`;
  // Follow at most a few pages: a booking horizon is weeks, not years.
  for (let page = 0; next && page < 5; page++) {
    const response: Response = await timed(next, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Busy request failed (${response.status}).`);
    const body = await response.json();
    const items = microsoftBusy(body);
    if (!items) throw new Error("Unreadable busy reply.");
    busy.push(...items);
    const link: unknown = body["@odata.nextLink"];
    next = typeof link === "string" && link.startsWith(new URL(url).origin) ? link : null;
  }
  return busy;
}

// Busy periods for the booking page. Anything that goes wrong is recorded on
// the connection, so the recruiter is told, and the page carries on with the
// weekly hours alone.
export async function calendarBusy(userId: string, from: Date, to: Date): Promise<{ busy: Busy[]; connected: boolean; failed: boolean }> {
  const connection = await db.calendarConnection.findUnique({ where: { userId } });
  if (!connection) return { busy: [], connected: false, failed: false };
  const key = calendarKey();
  const refreshToken = key ? decryptToken(key, connection.tokenCipher) : null;
  try {
    if (!refreshToken || !providerCredentials(connection.provider)) throw new Error("Calendar connection cannot be used.");
    const token = await accessToken(userId, connection.provider, refreshToken);
    const busy = await fetchBusy(connection.provider, token, from, to);
    if (connection.lastErrorAt) await db.calendarConnection.update({ where: { userId }, data: { lastErrorAt: null } });
    return { busy, connected: true, failed: false };
  } catch {
    forgetAccessToken(userId);
    await db.calendarConnection.update({ where: { userId }, data: { lastErrorAt: new Date() } }).catch(() => undefined);
    return { busy: [], connected: true, failed: true };
  }
}

export async function saveConnection(userId: string, provider: string, refreshToken: string, scope: string) {
  const key = calendarKey();
  if (!key) throw new Error("No key to keep calendar tokens with.");
  const tokenCipher = encryptToken(key, refreshToken);
  forgetAccessToken(userId);
  await db.calendarConnection.upsert({
    where: { userId },
    create: { userId, provider, tokenCipher, scope },
    update: { provider, tokenCipher, scope, connectedAt: new Date(), lastErrorAt: null },
  });
}

// Google lets an app give its access back; Microsoft's is removed from the
// account's own app settings. Either way the stored token is deleted.
export async function revokeConnection(userId: string) {
  const connection = await db.calendarConnection.findUnique({ where: { userId } });
  if (!connection) return;
  const key = calendarKey();
  const refreshToken = key ? decryptToken(key, connection.tokenCipher) : null;
  const revoke = endpoints(connection.provider).revoke;
  if (refreshToken && revoke) {
    await timed(revoke, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refreshToken }) }).catch(() => undefined);
  }
  forgetAccessToken(userId);
  await db.calendarConnection.deleteMany({ where: { userId } });
}
