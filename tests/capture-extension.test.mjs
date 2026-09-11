import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import vm from "node:vm";
import { packageExtension, validateOrigin } from "../scripts/package-extension.mjs";

const source = readFileSync(new URL("../extension/popup.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../extension/popup.html", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const roles = [
  { id: "role-a", title: "Finance Analyst", client: null },
  { id: "role-b", title: "Controller", client: "Example client" },
];
const account = { id: "user-a", name: "Alice Recruiter", email: "alice@example.test" };
const otherAccount = { id: "user-b", name: "Bob Recruiter", email: "bob@example.test" };
const roleKey = (url = "http://localhost:3000", id = account.id) => `lastRole:${JSON.stringify([url, id])}`;
const config = { url: "http://localhost:3000", token: "fixture-capture-key", [roleKey()]: "role-b" };
const copy = (value) => JSON.parse(JSON.stringify(value));

class Element {
  constructor(tag = "input", attributes = "") {
    this.tag = tag;
    this.value = attributes.match(/value="([^"]*)"/)?.[1] || "";
    this.hidden = /\bhidden\b/.test(attributes);
    this.disabled = /\bdisabled\b/.test(attributes);
    this.textContent = "";
    this.className = "";
    this.children = [];
    this.handlers = new Map();
  }
  set innerHTML(value) {
    assert.equal(value, "");
    this.children = [];
    this.value = "";
  }
  append(child) {
    this.children.push(child);
    if (this.tag === "select" && this.children.length === 1) this.value = child.value;
  }
  addEventListener(event, handler) {
    this.handlers.set(event, [...(this.handlers.get(event) || []), handler]);
  }
  async dispatch(event) {
    if (event === "click" && this.disabled) return;
    for (const handler of this.handlers.get(event) || []) {
      await handler({ preventDefault() {}, target: this });
    }
  }
  focus() {
    this.focused = true;
  }
}

async function popup(options = {}) {
  const elements = Object.fromEntries([...(options.html || html).matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)]
    .map(([, tag, attributes, id]) => [id, new Element(tag, attributes)]));
  const stored = { ...(options.stored ?? config) };
  const requests = [];
  const responses = [...(options.responses || [])];
  const delays = [];
  let reads = 0;
  let queries = 0;
  const context = vm.createContext({
    URL, AbortSignal, AbortController, clearTimeout,
    ...(options.origins === undefined ? {} : { CAPTURE_WORKBENCH_ORIGINS: options.origins }),
    setTimeout: (callback, delay) => {
      delays.push(delay);
      return setTimeout(callback, options.timeout ?? delay);
    },
    document: {
      getElementById: (id) => elements[id],
      createElement: (tag) => new Element(tag),
    },
    chrome: {
      storage: { local: {
        get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, stored[key]])),
        set: async (values) => {
          if (options.failRemember && Object.keys(values).some((key) => key.startsWith("lastRole:"))) throw new Error("Storage unavailable");
          Object.assign(stored, values);
        },
        remove: async (key) => { delete stored[key]; },
      } },
      tabs: { query: async () => {
        queries += 1;
        if (options.queryError) throw new Error("No tab access");
        return options.noTab ? [] : [{ id: 7 }];
      } },
      scripting: { executeScript: async ({ target, func }) => {
        reads += 1;
        assert.deepEqual(copy(target), { tabId: 7 });
        if (options.injectionError) throw new Error("Cannot access this page");
        return [{ result: extract(func, options.profile) }];
      } },
    },
    fetch: async (url, init) => {
      requests.push({ url, ...init });
      const next = responses.shift() ?? { status: 200, body: { account, roles } };
      if (next instanceof Error) throw next;
      const result = typeof next === "function" ? await next(init) : next;
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        json: async () => {
          if (result.invalidJson) throw new SyntaxError("Invalid JSON");
          return result.body;
        },
      };
    },
  });
  if (options.configSource) vm.runInContext(options.configSource, context);
  await vm.runInContext(options.source || source, context);
  return {
    elements, stored, requests, responses, delays,
    get reads() { return reads; },
    get queries() { return queries; },
    click: (id) => elements[id].dispatch("click"),
    edit: async (id, value) => { elements[id].value = value; await elements[id].dispatch("input"); await elements[id].dispatch("change"); },
  };
}

function extract(func, options = {}) {
  const nodes = options.nodes ?? { "main h1": " Priya   Kaur ", "main .text-body-medium": " Finance Analyst " };
  const context = vm.createContext({
    location: new URL(options.url || "https://www.linkedin.com/in/priya-kaur/details/experience/?tracking=1"),
    document: {
      title: options.title ?? "(3) Priya Kaur | LinkedIn",
      querySelector: (selector) => selector in nodes ? {
        textContent: nodes[selector],
        getAttribute: () => nodes[selector],
      } : null,
    },
  });
  return vm.runInContext(`(${func.toString()})()`, context);
}

const saved = { status: 201, body: { ok: true, candidateId: "candidate-a", fullName: "Priya Kaur", warning: null } };

test("manifest grants only click-triggered reading and loopback workbench access", () => {
  assert.equal(manifest.name, "Capture");
  assert.equal(manifest.action.default_title, "Save this profile to Capture");
  assert.match(manifest.description, /\bCapture\b/);
  for (const text of [manifest.name, manifest.action.default_title, manifest.description]) {
    assert.doesNotMatch(text, /basanite|recruiter workbench|capture capture/i);
  }
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
  assert.deepEqual(manifest.host_permissions, ["http://localhost/*", "http://127.0.0.1/*"]);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.equal(manifest.optional_permissions, undefined);
  assert.equal(manifest.content_security_policy.extension_pages,
    "script-src 'self'; object-src 'self'; connect-src http://localhost:* http://127.0.0.1:*;");
  assert.doesNotMatch(html, /workbench\.js|https?:\/\/[^<]+<\/script>/);
});

test("first run does not request data or read a tab until connected", async () => {
  const p = await popup({ stored: {} });
  assert.equal(p.elements.setup.hidden, false);
  assert.equal(p.elements.url.value, config.url);
  assert.equal(p.requests.length, 0);
  assert.equal(p.reads, 0);
  await p.edit("token", config.token);
  await p.click("connect");
  assert.equal(p.stored.token, config.token);
  assert.equal(p.elements.capture.hidden, false);
  assert.equal(p.reads, 1);
});

test("capture prefills the profile, recalls the role, focuses empty notes and never auto-saves", async () => {
  const p = await popup();
  assert.equal(p.elements.name.value, "Priya Kaur");
  assert.equal(p.elements.headline.value, "Finance Analyst");
  assert.equal(p.elements.profile.value, "https://www.linkedin.com/in/priya-kaur/");
  assert.equal(p.elements.role.value, "role-b");
  assert.equal(p.elements.role.children[1].textContent, "Controller (Example client)");
  assert.equal(p.elements.notes.value, "");
  assert.equal(p.elements.notes.focused, true);
  assert.equal(p.requests.length, 1);
  assert.equal(p.reads, 1);
});

test("stale last role falls back to an available role", async () => {
  const p = await popup({ stored: { ...config, [roleKey()]: "gone" } });
  assert.equal(p.elements.role.value, "role-a");
});

test("extraction falls back to heading, title and truncated metadata and forces HTTPS", async () => {
  const heading = await popup({ profile: { nodes: { h1: "Fallback Name" } } });
  assert.equal(heading.elements.name.value, "Fallback Name");
  const p = await popup({ profile: {
    url: "http://www.linkedin.com/in/priya-kaur/?tracking=2",
    title: "(99+) Priya Kaur | LinkedIn",
    nodes: { 'meta[name="description"]': "x".repeat(200) },
  } });
  assert.equal(p.elements.name.value, "Priya Kaur");
  assert.equal(p.elements.headline.value, "x".repeat(160));
  assert.equal(p.elements.profile.value, "https://www.linkedin.com/in/priya-kaur/");
});

for (const [label, options] of [
  ["restricted page", { injectionError: true }],
  ["tab query failure", { queryError: true }],
  ["missing active tab", { noTab: true }],
  ["missing markup", { profile: { nodes: {}, title: "" } }],
  ["search results", { profile: { url: "https://www.linkedin.com/search/results/people/" } }],
  ["non-LinkedIn profile-like path", { profile: { url: "https://example.com/in/person/" } }],
]) {
  test(`${label} warns and permits a fully manual save`, async () => {
    const p = await popup(options);
    assert.notEqual(p.elements.message.textContent, "");
    await p.edit("name", "Manual Name");
    await p.edit("headline", "Edited headline");
    await p.edit("profile", "www.linkedin.com/in/manual/");
    await p.edit("notes", "My own judgement");
    p.responses.push(saved);
    await p.click("save");
    assert.deepEqual(JSON.parse(p.requests.at(-1).body), {
      roleId: "role-b", fullName: "Manual Name", headline: "Edited headline",
      profileUrl: "www.linkedin.com/in/manual/", notes: "My own judgement",
    });
  });
}

for (const address of ["https://example.com", "http://localhost.example.com", "http://localhost@evil.example", "http://127.0.0.2", "ftp://localhost", "http://localhost:3000/path", "http://localhost:3000?token=x", "http://user:pass@localhost:3000", "not a url"]) {
  test(`refuses non-workbench address ${address} before any fetch, including stored settings`, async () => {
    const p = await popup({ stored: { ...config, url: address } });
    assert.equal(p.requests.length, 0);
    assert.equal(p.reads, 0);
    assert.equal(p.elements.setup.hidden, false);
    assert.match(p.elements["setup-message"].textContent, /localhost|127\.0\.0\.1/);
    await p.click("connect");
    assert.equal(p.requests.length, 0);
  });
}

test("requests use the configured loopback origin, token, no redirects or cookies and a timeout", async () => {
  const p = await popup({ stored: { ...config, url: "http://127.0.0.1:3100/" } });
  const request = p.requests[0];
  assert.equal(request.url, "http://127.0.0.1:3100/api/capture");
  assert.equal(request.headers["X-Capture-Token"], config.token);
  assert.equal(request.redirect, "error");
  assert.equal(request.credentials, "omit");
  assert.equal(request.cache, "no-store");
  assert.ok(request.signal instanceof AbortSignal);
});

test("a hung save is aborted, preserves notes and permits a manual retry", async () => {
  const p = await popup({ timeout: 1 });
  await p.edit("notes", "Keep this note");
  p.responses.push((init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
  }));
  await p.click("save");
  assert.equal(p.requests.at(-1).signal.aborted, true);
  assert.equal(p.elements.notes.value, "Keep this note");
  assert.equal(p.elements.save.disabled, false);
  assert.match(p.elements.message.textContent, /check the role before retrying/i);
});

test("connection network failure is actionable and retryable", async () => {
  const p = await popup({ responses: [new TypeError("Failed to fetch")] });
  assert.equal(p.elements.setup.hidden, false);
  assert.match(p.elements["setup-message"].textContent, /running|reach/i);
  await p.click("connect");
  assert.equal(p.elements.capture.hidden, false);
  assert.equal(p.elements.connect.disabled, false);
});

for (const response of [
  { status: 400, body: { error: "Pick a role first." } },
  { status: 409, body: { error: "Priya is already on this role with that profile link." } },
  { status: 500, body: { error: "Try again later." } },
  new TypeError("Failed to fetch"),
]) {
  test(`save failure ${response.status || "network"} preserves edits and permits retry`, async () => {
    const p = await popup();
    await p.edit("notes", "Keep this note");
    p.responses.push(response);
    await p.click("save");
    assert.equal(p.elements.save.disabled, false);
    assert.equal(p.elements.notes.value, "Keep this note");
    assert.equal(p.elements.name.value, "Priya Kaur");
    if (response.body) assert.equal(p.elements.message.textContent, response.body.error);
    else assert.match(p.elements.message.textContent, /reach|running/i);
    p.responses.push(saved);
    await p.click("save");
    assert.match(p.elements.message.textContent, /Saved Priya Kaur/);
  });
}

test("POST 401 requests a fresh key and reconnect preserves all edits without rereading", async () => {
  const p = await popup();
  await p.edit("name", "Edited name");
  await p.edit("notes", "Keep my assessment");
  await p.edit("role", "role-a");
  p.responses.push({ status: 401, body: { error: "Capture token missing or wrong. Copy it again from Settings." } });
  await p.click("save");
  assert.equal(p.elements.setup.hidden, false);
  assert.equal(p.elements.token.value, "");
  assert.equal(p.stored.token, undefined);
  assert.match(p.elements["setup-message"].textContent, /key|token/i);
  await p.edit("token", "new-fixture-key");
  await p.click("connect");
  assert.equal(p.elements.name.value, "Edited name");
  assert.equal(p.elements.notes.value, "Keep my assessment");
  assert.equal(p.elements.role.value, "role-a");
  assert.equal(p.reads, 1);
  assert.equal(p.elements.save.disabled, false);
});

test("POST 404 refreshes roles without rereading or changing edited profile fields", async () => {
  const p = await popup();
  await p.edit("name", "Edited name");
  await p.edit("notes", "Keep this note");
  p.responses.push(
    { status: 404, body: { error: "That role no longer exists." } },
    { status: 200, body: { account, roles: [roles[0]] } },
  );
  await p.click("save");
  assert.equal(p.requests.length, 3);
  assert.equal(p.elements.role.children.length, 1);
  assert.equal(p.elements.role.value, "role-a");
  assert.equal(p.elements.name.value, "Edited name");
  assert.equal(p.elements.notes.value, "Keep this note");
  assert.equal(p.reads, 1);
  assert.match(p.elements.message.textContent, /no longer exists/);
  assert.equal(p.elements.save.disabled, false);
});

test("settings reconnect does not reread a page or replace manually edited fields", async () => {
  const p = await popup();
  await p.edit("name", "Edited name");
  await p.click("settings");
  await p.click("connect");
  assert.equal(p.reads, 1);
  assert.equal(p.elements.name.value, "Edited name");
});

test("success confirms saving as well as duplicate-name warnings, clears notes and remembers the role", async () => {
  const p = await popup();
  await p.edit("role", "role-a");
  await p.edit("notes", "Personal assessment");
  p.responses.push({ ...saved, body: { ...saved.body, warning: "This role already had someone called Priya Kaur." } });
  await p.click("save");
  assert.match(p.elements.message.textContent, /Saved Priya Kaur/);
  assert.match(p.elements.message.textContent, /already had someone/);
  assert.equal(p.stored[roleKey()], "role-a");
  assert.equal(p.stored.lastRoleId, undefined);
  assert.equal(p.elements.notes.value, "");
  const count = p.requests.length;
  await p.click("save");
  assert.equal(p.requests.length, count);
  await p.edit("name", "Another person");
  assert.equal(p.elements.save.disabled, false);
});

test("storage failure after a successful POST still confirms the save rather than offering a duplicate retry", async () => {
  const p = await popup({ failRemember: true });
  await p.edit("notes", "Personal note");
  p.responses.push(saved);
  await p.click("save");
  assert.equal(p.elements.notes.value, "");
  assert.match(p.elements.message.textContent, /Saved Priya Kaur/);
  assert.match(p.elements.message.textContent, /remember/i);
  assert.equal(p.elements.save.disabled, true);
});

for (const body of [{ account, roles: [] }, { roles: "invalid" }, null]) {
  test(`unavailable or invalid role list ${JSON.stringify(body)} keeps setup actionable without reading`, async () => {
    const p = await popup({ responses: [{ status: 200, body }] });
    assert.equal(p.elements.setup.hidden, false);
    assert.notEqual(p.elements["setup-message"].textContent, "");
    assert.equal(p.reads, 0);
  });
}

// A host that is still starting answers from its own front door, not from the
// app, so there is no JSON error to show and the status is all we have.
for (const status of [502, 503, 504]) {
  test(`a ${status} from a starting host reads as not ready rather than not reachable`, async () => {
    const p = await popup({ responses: [{ status, invalidJson: true }] });
    assert.equal(p.elements.setup.hidden, false);
    assert.ok(p.elements["setup-message"].textContent.includes(`not ready yet (${status})`),
      p.elements["setup-message"].textContent);
    assert.match(p.elements["setup-message"].textContent, /try again/i);
    p.responses.push({ status: 200, body: { account, roles } });
    await p.click("connect");
    assert.equal(p.elements.capture.hidden, false);
  });
}

test("a server error that does explain itself is shown as sent", async () => {
  const p = await popup({ responses: [{ status: 503, body: { error: "Database maintenance until 14:00." } }] });
  assert.equal(p.elements["setup-message"].textContent, "Database maintenance until 14:00.");
});

test("malformed JSON response does not break error recovery", async () => {
  const p = await popup({ responses: [{ status: 502, invalidJson: true }] });
  assert.equal(p.elements.setup.hidden, false);
  assert.notEqual(p.elements["setup-message"].textContent, "");
});

test("GET 401 discards the refused key before any tab read", async () => {
  const p = await popup({ responses: [{ status: 401, body: { error: "Wrong capture token." } }] });
  assert.equal(p.elements.setup.hidden, false);
  assert.equal(p.elements.token.value, "");
  assert.equal(p.stored.token, undefined);
  assert.equal(p.reads, 0);
  assert.match(p.elements["setup-message"].textContent, /Wrong capture token/);
});

test("an in-flight save prevents double submission and changes to its fields or connection", async () => {
  const p = await popup();
  let finish;
  const response = new Promise((resolve) => { finish = resolve; });
  p.responses.push(() => response);
  const saving = p.click("save");
  assert.equal(p.elements.save.disabled, true);
  for (const id of ["role", "name", "headline", "profile", "notes", "settings"]) {
    assert.equal(p.elements[id].disabled, true);
  }
  await p.click("save");
  await p.click("settings");
  assert.equal(p.elements.capture.hidden, false);
  assert.equal(p.requests.length, 2);
  finish(saved);
  await saving;
  for (const id of ["role", "name", "headline", "profile", "notes", "settings"]) {
    assert.equal(p.elements[id].disabled, false);
  }
});

test("double connect makes just one roles request and one extraction", async () => {
  const p = await popup({ stored: {} });
  await p.edit("token", config.token);
  let finish;
  const response = new Promise((resolve) => { finish = resolve; });
  p.responses.push(() => response);
  const connecting = p.click("connect");
  assert.equal(p.elements.connect.disabled, true);
  await p.click("connect");
  finish({ status: 200, body: { account, roles } });
  await connecting;
  assert.equal(p.requests.length, 1);
  assert.equal(p.reads, 1);
  assert.equal(p.elements.connect.disabled, false);
});

for (const refresh of [{ status: 200, body: { account, roles: [] } }, new TypeError("Failed to fetch")]) {
  test(`404 followed by ${refresh.status ? "no open roles" : "network failure"} preserves the draft through reconnect`, async () => {
    const p = await popup();
    await p.edit("notes", "Keep this draft");
    p.responses.push({ status: 404, body: { error: "That role no longer exists." } }, refresh);
    await p.click("save");
    assert.equal(p.elements.setup.hidden, false);
    assert.equal(p.elements.notes.value, "Keep this draft");
    assert.equal(p.elements.save.disabled, false);
    await p.click("connect");
    assert.equal(p.elements.capture.hidden, false);
    assert.equal(p.elements.notes.value, "Keep this draft");
    assert.equal(p.reads, 1);
  });
}

test("connected account identity is prominent and independent of website login", async () => {
  const p = await popup();
  assert.equal(p.elements.connection.hidden, false);
  assert.equal(p.elements["account-name"].textContent, account.name);
  assert.equal(p.elements["account-email"].textContent, account.email);
  assert.equal(p.elements["account-origin"].textContent, config.url);
  assert.match(html, /Website login is independent/);
  assert.match(html, /paste that account's key/);
  const nameless = await popup({ responses: [{ status: 200, body: { account: { ...account, name: null }, roles } }] });
  assert.equal(nameless.elements["account-name"].textContent, account.email);
});

for (const invalid of [undefined, null, {}, { ...account, id: "" }, { ...account, email: "" }, { ...account, name: 12 }]) {
  test(`invalid connected account ${JSON.stringify(invalid)} never exposes capture or reads a tab`, async () => {
    const p = await popup({ responses: [{ status: 200, body: { account: invalid, roles } }] });
    assert.equal(p.elements.setup.hidden, false);
    assert.equal(p.elements.connection.hidden, true);
    assert.equal(p.elements.capture.hidden, true);
    assert.equal(p.reads, 0);
    assert.match(p.elements["setup-message"].textContent, /invalid account/);
  });
}

test("an account with no roles still shows who is connected without reading a tab", async () => {
  const p = await popup({ responses: [{ status: 200, body: { account, roles: [] } }] });
  assert.equal(p.elements.connection.hidden, false);
  assert.equal(p.elements["account-email"].textContent, account.email);
  assert.match(p.elements["setup-message"].textContent, /this account/);
  assert.equal(p.reads, 0);
});

test("legacy global role preference is ignored rather than assigned to an unknown account", async () => {
  const p = await popup({ stored: { url: config.url, token: config.token, lastRoleId: "role-b" } });
  assert.equal(p.elements.role.value, "role-a");
  p.responses.push(saved);
  await p.click("save");
  assert.equal(p.stored[roleKey()], "role-a");
  assert.equal(p.stored.lastRoleId, "role-b");
});

test("switching capture keys isolates account role preferences, keeps the draft and reads only once", async () => {
  const p = await popup();
  await p.edit("notes", "My private manual draft");
  await p.edit("name", "Edited name");
  await p.click("settings");
  await p.edit("token", "bob-key");
  p.responses.push({ status: 200, body: { account: otherAccount, roles } });
  await p.click("connect");
  assert.equal(p.elements.role.value, "role-a");
  assert.equal(p.elements["account-email"].textContent, otherAccount.email);
  assert.equal(p.requests.at(-1).headers["X-Capture-Token"], "bob-key");
  assert.equal(p.elements.notes.value, "My private manual draft");
  assert.equal(p.elements.name.value, "Edited name");
  assert.equal(p.reads, 1);
  p.responses.push(saved);
  await p.click("save");
  assert.equal(p.stored[roleKey(config.url, otherAccount.id)], "role-a");
  assert.equal(p.stored[roleKey()], "role-b");
  await p.click("settings");
  await p.edit("token", config.token);
  await p.click("connect");
  assert.equal(p.elements.role.value, "role-b");
  assert.equal(p.elements.save.disabled, false);
  assert.equal(p.elements["account-email"].textContent, account.email);
  assert.equal(p.reads, 1);
});

test("an account reconnect recalls only its own stored role even when role IDs overlap", async () => {
  const p = await popup({ stored: { ...config, [roleKey(config.url, otherAccount.id)]: "role-a" } });
  assert.equal(p.elements.role.value, "role-b");
  await p.click("settings");
  await p.edit("token", "bob-key");
  p.responses.push({ status: 200, body: { account: otherAccount, roles } });
  await p.click("connect");
  assert.equal(p.elements.role.value, "role-a");
});

test("the same account ID on different origins has independent remembered roles", async () => {
  const origin = "https://workbench.example.test:8443";
  const p = await popup({ origins: [origin], stored: { ...config, [roleKey(origin)]: "role-a" } });
  await p.edit("notes", "Keep across origins");
  await p.click("settings");
  await p.edit("url", origin + "/");
  await p.click("connect");
  assert.equal(p.elements.role.value, "role-a");
  p.responses.push(saved);
  await p.click("save");
  assert.equal(p.stored[roleKey(origin)], "role-a");
  assert.equal(p.stored[roleKey()], "role-b");
  assert.equal(p.reads, 1);
});

test("failed account switch clears the old identity, preserves notes and permits another account", async () => {
  const p = await popup();
  await p.edit("notes", "Keep my draft");
  await p.click("settings");
  await p.edit("token", "refused-key");
  p.responses.push({ status: 401, body: { error: "Capture key revoked." } });
  await p.click("connect");
  assert.equal(p.elements.connection.hidden, true);
  assert.equal(p.elements["account-email"].textContent, "");
  assert.equal(p.stored.token, undefined);
  assert.equal(p.elements.notes.value, "Keep my draft");
  await p.edit("token", "bob-key");
  p.responses.push({ status: 200, body: { account: otherAccount, roles } });
  await p.click("connect");
  assert.equal(p.elements.role.value, "role-a");
  assert.equal(p.elements["account-email"].textContent, otherAccount.email);
  assert.equal(p.reads, 1);
});

const hostedOrigin = "https://workbench.example.test:8443";
test("a configured HTTPS origin is the packaged default and uses the capture token without cookies or redirects", async () => {
  const p = await popup({ origins: [hostedOrigin], stored: {} });
  assert.equal(p.elements.url.value, hostedOrigin);
  await p.edit("token", config.token);
  await p.click("connect");
  p.responses.push(saved);
  await p.click("save");
  for (const request of p.requests) {
    assert.equal(request.url, `${hostedOrigin}/api/capture`);
    assert.equal(request.headers["X-Capture-Token"], config.token);
    assert.equal(request.redirect, "error");
    assert.equal(request.credentials, "omit");
  }
});

// A hosted workbench on a free tier sleeps when idle. Waking it is slower than
// any healthy response, and much slower than the loopback timeout, so the two
// cases cannot share one deadline or one explanation.
test("a hosted workbench is given time to wake while loopback still fails fast", async () => {
  const hosted = await popup({ origins: [hostedOrigin], stored: { url: hostedOrigin, token: config.token } });
  assert.equal(hosted.requests[0].url, `${hostedOrigin}/api/capture`);
  assert.ok(hosted.delays.some((delay) => delay >= 60000), `expected a wake-up timeout, saw ${hosted.delays}`);
  const loopback = await popup();
  assert.ok(loopback.delays.every((delay) => delay <= 10000), `expected a short timeout, saw ${loopback.delays}`);
});

test("a hosted connection failure blames sleep rather than a server nobody started", async () => {
  const p = await popup({
    origins: [hostedOrigin],
    stored: { url: hostedOrigin, token: config.token },
    responses: [new TypeError("Failed to fetch")],
  });
  assert.equal(p.elements.setup.hidden, false);
  assert.match(p.elements["setup-message"].textContent, /wake up/i);
  assert.doesNotMatch(p.elements["setup-message"].textContent, /running at this address/i);
  await p.click("connect");
  assert.equal(p.elements.capture.hidden, false);
});

for (const address of [
  "https://workbench.example.test", "https://workbench.example.test:9443",
  "http://workbench.example.test:8443", "https://other.example.test:8443",
  "https://sub.workbench.example.test:8443", "https://workbench.example.test.evil.test:8443",
  `${hostedOrigin}/path`, `${hostedOrigin}/..`, `${hostedOrigin}?`, `${hostedOrigin}#`,
  `${hostedOrigin}?key=x`, `${hostedOrigin}#fragment`, "https://user:pass@workbench.example.test:8443",
]) {
  test(`configured HTTPS build refuses ${address} before sending a key`, async () => {
    const p = await popup({ origins: [hostedOrigin], stored: { ...config, url: address } });
    assert.equal(p.requests.length, 0);
    assert.equal(p.reads, 0);
    await p.click("connect");
    assert.equal(p.requests.length, 0);
    assert.equal(p.elements.setup.hidden, false);
  });
}

test("an invalid hosted config cannot enable HTTP remote requests", async () => {
  for (const origins of [["http://remote.example.test"], "https://workbench.example.test", null]) {
    const p = await popup({ origins, stored: { ...config, url: "http://remote.example.test" } });
    assert.equal(p.requests.length, 0);
    assert.equal(p.reads, 0);
  }
});

async function packagingFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "capture-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(new URL("../extension/", import.meta.url), join(root, "extension"), { recursive: true });
  return root;
}

test("packager makes a standalone exact-host build and leaves source loopback-only", async (t) => {
  const root = await packagingFixture(t);
  const output = await packageExtension(hostedOrigin + "/", root);
  assert.equal(output, join(root, "dist", "capture-extension"));
  assert.deepEqual((await readdir(output)).sort(), ["manifest.json", "popup.css", "popup.html", "popup.js", "workbench.js"]);
  const packaged = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
  assert.deepEqual(packaged.host_permissions, [...manifest.host_permissions, "https://workbench.example.test/*"]);
  assert.deepEqual(packaged.permissions, ["activeTab", "scripting", "storage"]);
  for (const key of ["background", "content_scripts", "optional_permissions", "optional_host_permissions"]) {
    assert.equal(packaged[key], undefined);
  }
  assert.equal(packaged.content_security_policy.extension_pages,
    `script-src 'self'; object-src 'self'; connect-src http://localhost:* http://127.0.0.1:* ${hostedOrigin};`);
  assert.doesNotMatch(JSON.stringify(packaged.host_permissions), /linkedin/i);
  assert.doesNotMatch(JSON.stringify(packaged), /unsafe-eval|https:\/\/\*|<all_urls>/i);
  const packagedHtml = await readFile(join(output, "popup.html"), "utf8");
  const packagedSource = await readFile(join(output, "popup.js"), "utf8");
  const configSource = await readFile(join(output, "workbench.js"), "utf8");
  assert.equal(packaged.name, "Capture");
  assert.equal(packaged.action.default_title, manifest.action.default_title);
  assert.equal(packaged.description, manifest.description);
  assert.equal(configSource, `"use strict";\nglobalThis.CAPTURE_WORKBENCH_ORIGINS = ${JSON.stringify([hostedOrigin])};\n`);
  assert.match(packagedHtml, /<script src="workbench\.js"><\/script>\s*<script src="popup\.js"><\/script>/);
  assert.equal(packagedSource, source);
  assert.equal(await readFile(join(output, "popup.css"), "utf8"), await readFile(join(root, "extension", "popup.css"), "utf8"));
  assert.equal(await readFile(join(root, "extension", "popup.html"), "utf8"), html);
  assert.deepEqual(JSON.parse(await readFile(join(root, "extension", "manifest.json"), "utf8")), manifest);
  const p = await popup({ html: packagedHtml, source: packagedSource, configSource, stored: {} });
  assert.equal(p.elements.url.value, hostedOrigin);
  await p.edit("token", config.token);
  await p.click("connect");
  assert.equal(p.requests[0].url, `${hostedOrigin}/api/capture`);
  assert.equal(p.reads, 1);
  await assert.rejects(packageExtension("https://different.example.test", root), /already exists/);
  assert.equal(await readFile(join(output, "workbench.js"), "utf8"), configSource);
});

test("packager refuses an existing unrelated output without modifying it", async (t) => {
  const root = await packagingFixture(t);
  const output = join(root, "dist", "capture-extension");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "important.txt"), "Do not overwrite");
  await assert.rejects(packageExtension(hostedOrigin, root), /already exists/);
  assert.deepEqual(await readdir(output), ["important.txt"]);
  assert.equal(await readFile(join(output, "important.txt"), "utf8"), "Do not overwrite");
});

test("packager refuses a symlinked output parent", async (t) => {
  const root = await packagingFixture(t);
  const elsewhere = join(root, "unrelated");
  await mkdir(elsewhere);
  await symlink(elsewhere, join(root, "dist"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(packageExtension(hostedOrigin, root), /not a real directory/);
  assert.deepEqual(await readdir(elsewhere), []);
});

for (const origin of [
  undefined, "", "http://workbench.example.test", "https://workbench.example.test/path",
  "https://workbench.example.test/..", "https://workbench.example.test?", "https://workbench.example.test#",
  "https://workbench.example.test?key=x", "https://workbench.example.test#fragment",
  "https://user:pass@workbench.example.test", "https://*.example.test", "https://linkedin.com", "https://www.linkedin.com",
  "https://workbench.example.test\\path", "https://@workbench.example.test", "https://workbench.\nexample.test",
]) {
  test(`packager rejects invalid origin ${String(origin)}`, () => {
    assert.throws(() => validateOrigin(origin), /HTTPS/);
  });
}

test("packager CLI requires a single explicit --origin and has no arbitrary output option", () => {
  for (const args of [[], ["--origin"], ["--origin", "http://example.test"], ["--origin", hostedOrigin, "--output", "elsewhere"]]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/package-extension.mjs", import.meta.url)), ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:|HTTPS/);
  }
});

for (const status of [200, 201]) {
  test(`invalid success body (${status}) is not mistaken for a confirmed save`, async () => {
    const p = await popup();
    await p.edit("notes", "Keep this note");
    p.responses.push({ status, body: {} });
    await p.click("save");
    assert.equal(p.elements.notes.value, "Keep this note");
    assert.match(p.elements.message.textContent, /Check the role/);
    assert.equal(p.elements.save.disabled, false);
  });
}
