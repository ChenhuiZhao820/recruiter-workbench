import { db } from "./db";
import { appOrigin } from "./auth";
import { calendarKey, decryptToken, encryptToken } from "./calendar-core.mjs";
import {
  MAX_BLOCKS,
  NOTION_VERSION,
  blockLine,
  joinLines,
  meetingParts,
  notionCredentials,
  notionEndpoints,
  pageTitle,
} from "./notion-core.mjs";

// Server side of the Notion connection. Requests go from this server to
// Notion only, on the recruiter's click, read-only, with a time limit. The
// tokens are kept encrypted with the server's key; Notion's own page picker,
// shown when connecting, decides which pages Capture can see at all.

const PROVIDER = "notion";
const TIMEOUT_MS = 8000;

export class NotionNeedsReconnect extends Error {}

export function notionRedirectUri() {
  return `${appOrigin()}/api/notion/callback`;
}

export function notionConfigured() {
  return Boolean(notionCredentials());
}

async function timed(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: "error", cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

type Tokens = { access: string; refresh: string | null };

async function tokenRequest(body: Record<string, string>) {
  const credentials = notionCredentials();
  if (!credentials) throw new Error("Notion is not configured.");
  const response = await timed(notionEndpoints().token, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Notion token request failed (${response.status}).`);
  return response.json() as Promise<{ access_token?: string; refresh_token?: string; workspace_name?: string }>;
}

function seal(tokens: Tokens) {
  const key = calendarKey();
  if (!key) throw new Error("No key to keep the Notion token with.");
  return encryptToken(key, JSON.stringify(tokens));
}

export async function connectNotion(userId: string, code: string) {
  const body = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: notionRedirectUri() });
  if (!body.access_token) throw new Error("Notion did not return a token.");
  const tokenCipher = seal({ access: body.access_token, refresh: body.refresh_token ?? null });
  const label = String(body.workspace_name ?? "").slice(0, 120);
  await db.integrationConnection.upsert({
    where: { userId_provider: { userId, provider: PROVIDER } },
    create: { userId, provider: PROVIDER, tokenCipher, label },
    update: { tokenCipher, label, connectedAt: new Date(), lastErrorAt: null },
  });
}

export async function notionConnection(userId: string) {
  return db.integrationConnection.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER } },
    select: { label: true, connectedAt: true, lastErrorAt: true },
  });
}

// Notion offers no way for an app to hand its access back, so disconnecting
// deletes the token here; the recruiter can also remove Capture under
// Settings > Connections in Notion.
export async function disconnectNotionFor(userId: string) {
  await db.integrationConnection.deleteMany({ where: { userId, provider: PROVIDER } });
}

async function tokensFor(userId: string): Promise<Tokens> {
  const row = await db.integrationConnection.findUnique({ where: { userId_provider: { userId, provider: PROVIDER } } });
  const key = calendarKey();
  const opened = row && key ? decryptToken(key, row.tokenCipher) : null;
  if (!opened || !notionCredentials()) throw new NotionNeedsReconnect("Connect Notion again.");
  return JSON.parse(opened) as Tokens;
}

async function markFailed(userId: string) {
  await db.integrationConnection.updateMany({ where: { userId, provider: PROVIDER }, data: { lastErrorAt: new Date() } }).catch(() => undefined);
}

// One call to Notion's API as this account. An expired access token is
// refreshed once; anything else that fails is recorded and reported.
async function notion(userId: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<Record<string, unknown>> {
  let tokens = await tokensFor(userId);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await timed(`${notionEndpoints().api}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${tokens.access}`,
        "notion-version": NOTION_VERSION,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (response.ok) return response.json();
    if (response.status === 401 && attempt === 0 && tokens.refresh) {
      const refreshed = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh }).catch(() => null);
      if (refreshed?.access_token) {
        tokens = { access: refreshed.access_token, refresh: refreshed.refresh_token ?? tokens.refresh };
        await db.integrationConnection.update({ where: { userId_provider: { userId, provider: PROVIDER } }, data: { tokenCipher: seal(tokens), lastErrorAt: null } });
        continue;
      }
    }
    await markFailed(userId);
    if (response.status === 401) throw new NotionNeedsReconnect("Connect Notion again.");
    throw new Error(`Notion request failed (${response.status}).`);
  }
  throw new NotionNeedsReconnect("Connect Notion again.");
}

export type NotionPage = { id: string; title: string; editedAt: string; url: string };

// Pages this account shared with Capture, most recently edited first.
export async function searchNotionPages(userId: string, query: string): Promise<NotionPage[]> {
  const body = await notion(userId, "/search", {
    method: "POST",
    body: {
      query: query.slice(0, 100),
      filter: { property: "object", value: "page" },
      sort: { timestamp: "last_edited_time", direction: "descending" },
      page_size: 12,
    },
  });
  const results = Array.isArray(body.results) ? body.results : [];
  return results
    .filter((page: { object?: string; in_trash?: boolean; archived?: boolean }) => page?.object === "page" && !page.in_trash && !page.archived)
    .map((page: { id: string; last_edited_time?: string; url?: string }) => ({
      id: page.id,
      title: pageTitle(page),
      editedAt: page.last_edited_time ?? "",
      url: page.url ?? "",
    }));
}

type Block = { id: string; type: string; has_children?: boolean; [key: string]: unknown };

// Every block under one block, following Notion's pages of results.
async function children(userId: string, blockId: string, budget: { left: number }): Promise<Block[]> {
  const blocks: Block[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}` : "?page_size=100";
    const body = await notion(userId, `/blocks/${encodeURIComponent(blockId)}/children${query}`);
    const results = (Array.isArray(body.results) ? body.results : []) as Block[];
    budget.left -= results.length;
    blocks.push(...results);
    cursor = body.has_more && typeof body.next_cursor === "string" && budget.left > 0 ? body.next_cursor : null;
  } while (cursor);
  return blocks;
}

async function linesUnder(userId: string, blockId: string, depth: number, budget: { left: number }): Promise<string[]> {
  const lines: string[] = [];
  for (const block of await children(userId, blockId, budget)) {
    if (budget.left <= 0) break;
    const line = blockLine(block, depth);
    if (line !== null) lines.push(line);
    // A meeting notes block points at its summary, notes and transcript.
    if (block.type === "meeting_notes") {
      for (const [heading, id] of meetingParts(block)) {
        lines.push("", `## ${heading}`, ...(await linesUnder(userId, id, 0, budget)));
      }
    } else if (block.has_children && depth < 3 && block.type !== "child_page" && block.type !== "child_database") {
      lines.push(...(await linesUnder(userId, block.id, depth + 1, budget)));
    }
  }
  return lines;
}

// A page as plain text for the screening form: its title, then its blocks.
export async function notionPageText(userId: string, pageId: string) {
  const page = await notion(userId, `/pages/${encodeURIComponent(pageId)}`);
  const title = pageTitle(page);
  const budget = { left: MAX_BLOCKS };
  const lines = await linesUnder(userId, pageId, 0, budget);
  const { text, cut } = joinLines([title, "", ...lines]);
  return { title, text, cut: cut || budget.left <= 0 };
}
