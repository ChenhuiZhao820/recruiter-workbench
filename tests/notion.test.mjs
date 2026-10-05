import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  MAX_IMPORT_CHARS,
  NOTION_VERSION,
  authorizeUrl,
  blockLine,
  isPageId,
  joinLines,
  meetingParts,
  notionCredentials,
  notionEndpoints,
  pageTitle,
  readNotionState,
  safeReturn,
  signNotionState,
} from "../lib/notion-core.mjs";

const key = createHash("sha256").update("test-only-calendar-token-key-00000000000").digest();
const otherKey = createHash("sha256").update("another-key-000000000000000000000000000").digest();
const text = (content) => ({ rich_text: [{ plain_text: content }] });

test("the sign-in state names who asked, is signed for Notion only, and expires", () => {
  const now = new Date("2026-10-06T10:00:00Z");
  const state = signNotionState(key, "user-1", now);
  assert.deepEqual(readNotionState(key, state, now), { userId: "user-1" });
  assert.equal(readNotionState(otherKey, state, now), null);
  assert.equal(readNotionState(key, state.replace("user-1", "user-2"), now), null);
  assert.equal(readNotionState(key, state.replace(".notion.", ".google."), now), null);
  assert.equal(readNotionState(key, state, new Date(now.getTime() + 11 * 60_000)), null);
  assert.equal(readNotionState(key, "", now), null);
});

test("Notion is asked as the user, with the signed state, and test endpoints only outside production", () => {
  const url = new URL(authorizeUrl({ clientId: "cid", redirectUri: "https://capture.example/api/notion/callback", state: "s1" }, {}));
  assert.equal(url.origin + url.pathname, "https://api.notion.com/v1/oauth/authorize");
  assert.equal(url.searchParams.get("owner"), "user");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "s1");
  assert.equal(notionEndpoints({ CAPTURE_TEST_NOTION_BASE_URL: "http://localhost:8766/notion" }).token, "http://localhost:8766/notion/v1/oauth/token");
  assert.equal(notionEndpoints({ NODE_ENV: "production", CAPTURE_TEST_NOTION_BASE_URL: "http://localhost:8766/notion" }).api, "https://api.notion.com/v1");
  assert.equal(NOTION_VERSION, "2026-03-11");
  const env = { NOTION_CLIENT_ID: "id", NOTION_CLIENT_SECRET: "secret", CALENDAR_TOKEN_KEY: "test-only-calendar-token-key-00000000000" };
  assert.deepEqual(notionCredentials(env), { clientId: "id", clientSecret: "secret" });
  assert.equal(notionCredentials({ ...env, CALENDAR_TOKEN_KEY: "short" }), null);
  assert.equal(notionCredentials({ ...env, NOTION_CLIENT_SECRET: "" }), null);
});

test("coming back goes only to a screening page or Settings", () => {
  assert.equal(safeReturn("/candidates/abcdefgh1234/screening"), "/candidates/abcdefgh1234/screening");
  assert.equal(safeReturn("/settings"), "/settings");
  for (const bad of ["https://evil.example", "//evil.example", "/candidates/x/screening", "/admin", "/candidates/abcdefgh1234/screening?x=1", null]) {
    assert.equal(safeReturn(bad), "/settings", String(bad));
  }
});

test("blocks become plain lines; meeting notes point at their parts; text past the limit is cut", () => {
  assert.equal(blockLine({ type: "heading_1", heading_1: text("Call") }), "# Call");
  assert.equal(blockLine({ type: "bulleted_list_item", bulleted_list_item: text("Leeds") }, 1), "  - Leeds");
  assert.equal(blockLine({ type: "to_do", to_do: { ...text("Spec"), checked: true } }), "[x] Spec");
  assert.equal(blockLine({ type: "paragraph", paragraph: text("") }), "");
  assert.equal(blockLine({ type: "image", image: {} }), null);
  assert.equal(blockLine({ type: "unsupported", unsupported: {} }), null);
  assert.equal(blockLine({ type: "meeting_notes", meeting_notes: { title: [{ plain_text: "Imogen" }] } }), "# Imogen");
  assert.deepEqual(meetingParts({ meeting_notes: { children: { summary_block_id: "s", transcript_block_id: "t" } } }), [["Summary", "s"], ["Transcript", "t"]]);
  assert.deepEqual(meetingParts({ meeting_notes: {} }), []);
  assert.equal(pageTitle({ properties: { Name: { type: "title", title: [{ plain_text: "Call " }, { plain_text: "notes" }] } } }), "Call notes");
  assert.equal(pageTitle({}), "Untitled");
  assert.deepEqual(joinLines(["a", "", "", "", "b"]), { text: "a\n\nb", cut: false });
  const long = joinLines(["x".repeat(MAX_IMPORT_CHARS + 10)]);
  assert.equal(long.text.length, MAX_IMPORT_CHARS);
  assert.equal(long.cut, true);
  assert.equal(isPageId("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isPageId("111111111111411181111111111111111"), false);
  assert.equal(isPageId("../secrets"), false);
});
