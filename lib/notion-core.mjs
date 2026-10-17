import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Importing a meeting note from the recruiter's own Notion, read-only, on
// their click. Shared by the app and the unit tests: the OAuth round trip and
// turning Notion's blocks into the plain text the screening form takes.
// Nothing here touches the database or the network.

export const NOTION_VERSION = "2026-03-11";
export const STATE_MINUTES = 10;
export const MAX_IMPORT_CHARS = 60_000;
export const MAX_BLOCKS = 1500;

// Notion's own endpoints, or a test server's when CAPTURE_TEST_NOTION_BASE_URL
// is set outside production.
export function notionEndpoints(env = process.env) {
  const test = env.NODE_ENV !== "production" ? env.CAPTURE_TEST_NOTION_BASE_URL?.replace(/\/$/, "") : "";
  const base = test || "https://api.notion.com";
  return { authorize: `${base}/v1/oauth/authorize`, token: `${base}/v1/oauth/token`, api: `${base}/v1` };
}

// Offered only when the server has the integration's credentials and a key to
// keep tokens with (the same CALENDAR_TOKEN_KEY the calendar uses).
export function notionCredentials(env = process.env) {
  const clientId = env.NOTION_CLIENT_ID?.trim();
  const clientSecret = env.NOTION_CLIENT_SECRET?.trim();
  const key = env.CALENDAR_TOKEN_KEY?.trim() ?? "";
  return clientId && clientSecret && key.length >= 32 ? { clientId, clientSecret } : null;
}

export function authorizeUrl({ clientId, redirectUri, state }, env = process.env) {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", owner: "user", state });
  return `${notionEndpoints(env).authorize}?${params.toString()}`;
}

// Who started the connection and until when, signed, so a forged or replayed
// reply cannot attach a Notion workspace to someone else's account.
export function signNotionState(key, userId, now = new Date()) {
  const body = `${userId}.notion.${now.getTime() + STATE_MINUTES * 60_000}.${randomBytes(8).toString("base64url")}`;
  return `${body}.${createHmac("sha256", key).update(`notion-state:${body}`).digest("base64url")}`;
}

export function readNotionState(key, state, now = new Date()) {
  const parts = String(state ?? "").split(".");
  if (parts.length !== 5 || parts[1] !== "notion") return null;
  const body = parts.slice(0, 4).join(".");
  const expected = Buffer.from(createHmac("sha256", key).update(`notion-state:${body}`).digest("base64url"));
  const given = Buffer.from(parts[4]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (!(Number(parts[2]) > now.getTime())) return null;
  return { userId: parts[0] };
}

// Where the recruiter goes back to after connecting: the screening page they
// came from or Settings, never an address the request could choose freely.
export function safeReturn(path) {
  const value = String(path ?? "");
  return /^\/candidates\/[a-z0-9]{8,40}\/screening$/.test(value) || value === "/settings" ? value : "/settings";
}

const plain = (richText) => (Array.isArray(richText) ? richText.map((part) => part?.plain_text ?? "").join("") : "");

export function pageTitle(page) {
  const properties = page?.properties ?? {};
  for (const property of Object.values(properties)) {
    if (property?.type === "title") return plain(property.title).trim() || "Untitled";
  }
  return "Untitled";
}

const PREFIX = {
  heading_1: "# ",
  heading_2: "## ",
  heading_3: "### ",
  bulleted_list_item: "- ",
  numbered_list_item: "- ",
  quote: "> ",
  toggle: "",
  paragraph: "",
  callout: "",
  code: "",
};

// One block as one line of text, or null for blocks that carry no text
// (images, dividers, embeds) or that the API does not support.
export function blockLine(block, depth = 0) {
  const type = block?.type;
  const content = block?.[type];
  if (!type || !content) return null;
  const indent = "  ".repeat(depth);
  if (type === "to_do") return `${indent}[${content.checked ? "x" : " "}] ${plain(content.rich_text)}`;
  if (type === "meeting_notes") return `${indent}# ${plain(content.title) || "Meeting notes"}`;
  if (!(type in PREFIX)) return null;
  const text = plain(content.rich_text);
  return text || type === "paragraph" ? `${indent}${PREFIX[type]}${text}` : null;
}

// The parts of a meeting notes block worth importing, in reading order.
export function meetingParts(block) {
  const children = block?.meeting_notes?.children ?? {};
  return [
    ["Summary", children.summary_block_id],
    ["Notes", children.notes_block_id],
    ["Transcript", children.transcript_block_id],
  ].filter(([, id]) => typeof id === "string" && id);
}

// Lines joined, runs of blank lines collapsed, and cut at the form's limit.
export function joinLines(lines) {
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > MAX_IMPORT_CHARS ? { text: text.slice(0, MAX_IMPORT_CHARS), cut: true } : { text, cut: false };
}

export function isPageId(value) {
  return /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(String(value ?? ""));
}
