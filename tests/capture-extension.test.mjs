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
// The origin the source build is for, and the one a package overrides.
const deployment = "https://retrivr.app";
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
    this.dataset = {};
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
  const listeners = { activated: [], updated: [] };
  const panel = { opened: [], options: [], closed: 0 };
  const requests = [];
  const permissionAsks = [];
  const opened = [];
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
        remove: async (keys) => { for (const key of (Array.isArray(keys) ? keys : [keys])) delete stored[key]; },
      } },
      tabs: {
        create: async ({ url }) => { opened.push(url); },
        query: async () => {
          queries += 1;
          if (options.queryError) throw new Error("No tab access");
          return options.noTab ? [] : [{ id: 7, windowId: 3 }];
        },
        onActivated: { addListener: (fn) => listeners.activated.push(fn) },
        onUpdated: { addListener: (fn) => listeners.updated.push(fn) },
      },
      scripting: { executeScript: async ({ target, func }) => {
        reads += 1;
        assert.deepEqual(copy(target), { tabId: 7 });
        if (options.injectionError) throw new Error("Cannot access this page");
        return [{ result: extract(func, options.profile) }];
      } },
      // Chrome 116+ only. Left out by default so every other test also proves
      // the page still works where there is no side panel to offer.
      ...(options.sidePanel ? { sidePanel: {
        open: async (target) => { panel.opened.push(copy(target)); },
        setOptions: async (settings) => { panel.options.push(copy(settings)); },
      } } : {}),
      // Optional permissions. Absent by default, so every other test also
      // proves the page still works where LinkedIn was never allowed.
      permissions: {
        contains: async ({ origins }) => {
          permissionAsks.push({ kind: "contains", origins: copy(origins) });
          return Boolean(options.linkedInGranted);
        },
        request: async ({ origins }) => {
          permissionAsks.push({ kind: "request", origins: copy(origins) });
          if (options.grantRefused) return false;
          options.linkedInGranted = true;
          return true;
        },
      },
      runtime: {
        getContexts: async () => options.contexts ?? [{ contextType: "POPUP" }],
        // The version this copy actually is, which is the whole point of the
        // comparison: the source manifest, same as a real install.
        getManifest: () => copy(manifest),
      },
    },
    location: { hash: options.hash ?? "" },
    close: () => { panel.closed += 1; },
    fetch: async (url, init) => {
      requests.push({ url, ...init });
      const next = responses.shift() ?? { status: 200, body: { account, roles, extension: { version: options.packagedVersion ?? manifest.version } } };
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
    elements, stored, requests, permissionAsks, opened, responses, delays, listeners, panel,
    // Walking to the next profile: the tab reports a finished load, and from
    // then on the page reads whatever `options.profile` now describes.
    navigate: async (profile) => {
      options.profile = profile;
      for (const fn of listeners.updated) await fn(7, { status: "complete" });
      for (const fn of listeners.activated) await fn({ tabId: 7 });
    },
    get reads() { return reads; },
    get queries() { return queries; },
    click: (id) => elements[id].dispatch("click"),
    edit: async (id, value) => { elements[id].value = value; await elements[id].dispatch("input"); await elements[id].dispatch("change"); },
    toggle: async (id, checked) => { elements[id].checked = checked; await elements[id].dispatch("change"); },
  };
}

function extract(func, options = {}) {
  const nodes = options.nodes ?? {
    "main h1": " Priya   Kaur ",
    "main .text-body-medium": " Finance Analyst ",
    'a[href*="/messaging/compose/"]': "/messaging/compose/?recipient=ACoAAB1234xyz&profileUrn=urn",
  };
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
  assert.equal(manifest.name, "Retrivr");
  assert.equal(manifest.action.default_title, "Save this profile to Retrivr");
  assert.match(manifest.description, /\bRetrivr\b/);
  for (const text of [manifest.name, manifest.action.default_title, manifest.description]) {
    assert.doesNotMatch(text, /basanite|recruiter workbench|capture/i);
  }
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "sidePanel", "storage"]);
  assert.deepEqual(manifest.host_permissions, ["http://localhost/*", "http://127.0.0.1/*", `${deployment}/*`]);
  assert.doesNotMatch(JSON.stringify(manifest.host_permissions), /linkedin/i);
  // The one wildcard host allowed anywhere in here is the optional LinkedIn
  // origin checked just above; nothing else may carry one.
  assert.doesNotMatch(JSON.stringify({ ...manifest, optional_host_permissions: [] }),
    /unsafe-eval|https:\/\/\*|<all_urls>/i);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.action.default_popup, "popup.html");
  // The side panel is the same page, so it cannot reach anything the popup
  // could not reach either.
  assert.deepEqual(manifest.side_panel, { default_path: "popup.html" });
  // LinkedIn is optional, not granted at install, and asked for in the panel.
  // It is the only optional anything: no optional API permissions at all.
  assert.deepEqual(manifest.optional_host_permissions, ["https://*.linkedin.com/*"]);
  assert.equal(manifest.optional_permissions, undefined);
  assert.doesNotMatch(JSON.stringify(manifest.host_permissions), /linkedin/i);
  assert.equal(manifest.content_security_policy.extension_pages,
    `script-src 'self'; object-src 'self'; connect-src http://localhost:* http://127.0.0.1:* ${deployment};`);
  assert.doesNotMatch(html, /workbench\.js|https?:\/\/[^<]+<\/script>/);
});

const otherProfile = {
  url: "https://www.linkedin.com/in/sam-okafor/",
  title: "Sam Okafor | LinkedIn",
  nodes: { "main h1": " Sam Okafor ", "main .text-body-medium": " Plant Manager " },
};

test("a browser without a side panel is never offered one", async () => {
  const p = await popup();
  assert.equal(p.elements["panel-open"].hidden, true);
  assert.equal(p.elements["panel-close"].hidden, true);
  assert.equal(p.elements.eyebrow.hidden, false);
  assert.equal(p.elements.page.className, "");
  assert.equal(p.elements.capture.hidden, false);
  assert.equal(p.elements.name.value, "Priya Kaur");
});

test("the popup offers to keep Capture open, and opens the panel for the whole window", async () => {
  const p = await popup({ sidePanel: true });
  assert.equal(p.elements["panel-open"].hidden, false);
  assert.equal(p.elements["panel-open"].textContent, "Keep open");
  assert.equal(p.elements["panel-close"].hidden, true);
  await p.click("panel-open");
  // For the window, not the tab: a tab-scoped panel would vanish on the next
  // profile, which is the entire thing being fixed here.
  assert.deepEqual(p.panel.opened, [{ windowId: 3 }]);
  assert.deepEqual(p.panel.options.at(-1), { path: "popup.html#panel", enabled: true });
  assert.equal(p.stored.panelPinned, true);
  assert.equal(p.panel.closed, 0);
});

test("a popup opened while the panel is pinned says so", async () => {
  const p = await popup({ sidePanel: true, stored: { ...config, panelPinned: true } });
  assert.equal(p.elements["panel-open"].textContent, "Show panel");
});

test("the page opened as a panel knows it, offers a way out and is remembered", async () => {
  const p = await popup({ sidePanel: true, hash: "#panel" });
  assert.equal(p.elements.page.className, "surface-panel");
  assert.equal(p.elements["panel-close"].hidden, false);
  assert.equal(p.elements["panel-open"].hidden, true);
  assert.equal(p.elements.eyebrow.hidden, true);
  assert.equal(p.stored.panelPinned, true);
  assert.equal(p.elements.capture.hidden, false);
  await p.click("panel-close");
  assert.equal(p.panel.closed, 1);
  assert.equal(p.stored.panelPinned, false);
});

test("a panel opened from Chrome's own menu still recognises itself", async () => {
  // No hash, because nothing of ours put one there. No popup context is open,
  // and this page is running, so this page is the panel.
  const p = await popup({ sidePanel: true, contexts: [] });
  assert.equal(p.elements.page.className, "surface-panel");
  assert.equal(p.elements["panel-close"].hidden, false);
});

test("the panel follows the recruiter to the next profile", async () => {
  const p = await popup({ sidePanel: true, hash: "#panel" });
  assert.equal(p.elements.name.value, "Priya Kaur");
  await p.edit("notes", "Worth a call.");
  await p.navigate(otherProfile);
  assert.equal(p.elements.name.value, "Sam Okafor");
  assert.equal(p.elements.headline.value, "Plant Manager");
  assert.equal(p.elements.profile.value, "https://www.linkedin.com/in/sam-okafor/");
  // The note was about somebody else.
  assert.equal(p.elements.notes.value, "");
  assert.equal(p.elements.message.textContent, "");
  assert.equal(p.elements.reread.hidden, true);
  // Roles once, then one "have we met?" lookup per profile read - and nothing
  // else: navigating is not a reason to tell the workbench anything.
  assert.equal(p.requests.length, 3);
  assert.match(p.requests[1].url, /profileUrl=/);
  assert.match(p.requests[2].url, /profileUrl=/);
  assert.equal(p.requests.filter((r) => r.method === "POST").length, 0);
});

test("staying on the same profile does not disturb a note being typed", async () => {
  const p = await popup({ sidePanel: true, hash: "#panel" });
  await p.edit("notes", "Worth a call.");
  await p.navigate(undefined);
  assert.equal(p.elements.notes.value, "Worth a call.");
  assert.equal(p.elements.name.value, "Priya Kaur");
});

// LinkedIn moves between profiles without loading a page: the address names
// the next person first, and the heading and title follow when it has drawn
// them. Each step reports itself as a change to the tab, not a finished load.
const halfDrawn = (nodes, title = "Priya Kaur | LinkedIn") => ({ url: otherProfile.url, title, nodes });
async function tabChanged(p, options, profile, change) {
  options.profile = profile;
  for (const fn of p.listeners.updated) await fn(7, change);
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("moving within LinkedIn never leaves the last person's name under the next address", async () => {
  const options = { sidePanel: true, hash: "#panel", linkedInGranted: true };
  const p = await popup(options);
  assert.equal(p.elements.name.value, "Priya Kaur");
  await p.edit("notes", "Worth a call.");

  // The address has moved on; heading, title and Message link have not.
  await tabChanged(p, options, halfDrawn({
    "main h1": " Priya Kaur ",
    "main .text-body-medium": " Finance Analyst ",
    'a[href*="/messaging/compose/"]': "/messaging/compose/?recipient=ACoAAB1234xyz",
  }), { url: otherProfile.url });
  assert.equal(p.elements.name.value, "");
  assert.equal(p.elements.headline.value, "");
  assert.equal(p.elements.profile.value, otherProfile.url);
  assert.equal(p.elements.notes.value, "");
  assert.match(p.elements.message.textContent, /Reading this profile/);

  // The title changing is LinkedIn saying the next person is drawn.
  await tabChanged(p, options, otherProfile, { title: "Sam Okafor | LinkedIn" });
  assert.equal(p.elements.name.value, "Sam Okafor");
  assert.equal(p.elements.headline.value, "Plant Manager");
  assert.equal(p.elements.message.textContent, "");
  assert.equal(p.elements.reread.hidden, true);

  // Saved as Sam, without Priya's member id.
  await p.click("save");
  const saved = JSON.parse(p.requests.find((r) => r.method === "POST").body);
  assert.equal(saved.fullName, "Sam Okafor");
  assert.equal(saved.profileUrl, otherProfile.url);
  assert.equal(saved.memberId, "");
});

test("a heading drawn before the title is not trusted until they agree", async () => {
  const options = { sidePanel: true, hash: "#panel", linkedInGranted: true };
  const p = await popup(options);
  await tabChanged(p, options, halfDrawn({ "main h1": " Sam Okafor ", "main .text-body-medium": " Plant Manager " }), { url: otherProfile.url });
  assert.equal(p.elements.name.value, "");
  await tabChanged(p, options, otherProfile, { title: "Sam Okafor | LinkedIn" });
  assert.equal(p.elements.name.value, "Sam Okafor");
});

test("a page that settles without telling the tab is looked at again, a few times at most", async () => {
  const options = { sidePanel: true, hash: "#panel", linkedInGranted: true, timeout: 1 };
  const p = await popup(options);
  await tabChanged(p, options, halfDrawn({ "main h1": " Priya Kaur " }), { status: "complete" });
  assert.equal(p.elements.name.value, "");
  const before = p.reads;
  // Drawn now, with no event to say so: the panel's own second look finds it.
  options.profile = otherProfile;
  await wait(50);
  assert.equal(p.elements.name.value, "Sam Okafor");
  assert.equal(p.reads, before + 1);

  // One that never settles stops being looked at and hands back to the recruiter.
  await tabChanged(p, options, { ...halfDrawn({ "main h1": " Sam Okafor " }), url: "https://www.linkedin.com/in/ada-obi/" }, { url: "https://www.linkedin.com/in/ada-obi/" });
  await wait(100);
  const settledReads = p.reads;
  await wait(50);
  assert.equal(p.reads, settledReads, "no more reads once the tries run out");
  assert.equal(p.elements.name.value, "");
  assert.equal(p.elements.reread.hidden, false);
  assert.match(p.elements.message.textContent, /has not finished loading/);

  // A namesake, or a page that really is like that, is one click away.
  await p.click("reread");
  assert.equal(p.elements.name.value, "Sam Okafor");
  assert.equal(p.elements.profile.value, "https://www.linkedin.com/in/ada-obi/");
});

test("a name the recruiter corrected is not replaced when the page finishes drawing", async () => {
  const options = { sidePanel: true, hash: "#panel", linkedInGranted: true };
  const p = await popup(options);
  await tabChanged(p, options, { ...otherProfile, nodes: { "main h1": " Sam Okafor ", "main .text-body-medium": " Plant " } }, { url: otherProfile.url });
  assert.equal(p.elements.headline.value, "Plant");
  await p.edit("name", "Samuel Okafor");
  await p.edit("notes", "Met at the plant tour.");
  await tabChanged(p, options, otherProfile, { status: "complete" });
  assert.equal(p.elements.name.value, "Samuel Okafor");
  assert.equal(p.elements.headline.value, "Plant Manager");
  assert.equal(p.elements.notes.value, "Met at the plant tour.");
});

test("a panel refused a read after navigation empties the fields rather than guessing", async () => {
  const options = { sidePanel: true, hash: "#panel" };
  const p = await popup(options);
  await p.edit("notes", "Worth a call.");
  options.injectionError = true;
  await p.navigate(otherProfile);
  for (const id of ["name", "headline", "profile"]) assert.equal(p.elements[id].value, "");
  // The note is the one thing nobody else could have written. It survives, and
  // without a name it cannot be saved against the wrong person.
  assert.equal(p.elements.notes.value, "Worth a call.");
  assert.equal(p.elements.reread.hidden, false);
  assert.match(p.elements.message.textContent, /toolbar icon/);
  assert.equal(p.elements.message.className, "message bad");

  // The recruiter clicks the toolbar icon, which is what grants the read, then
  // asks the panel to try again.
  options.injectionError = false;
  options.profile = otherProfile;
  await p.click("reread");
  assert.equal(p.elements.name.value, "Sam Okafor");
  assert.equal(p.elements.reread.hidden, true);
  assert.equal(p.elements.message.textContent, "");
});

test("a load finishing in another tab leaves the panel alone", async () => {
  const options = { sidePanel: true, hash: "#panel" };
  const p = await popup(options);
  await p.edit("notes", "Worth a call.");
  const before = p.reads;
  options.injectionError = true;
  // Some other tab the recruiter left loading in the background.
  for (const fn of p.listeners.updated) await fn(99, { status: "complete" });
  assert.equal(p.reads, before, "an unrelated tab is not a reason to read this one");
  assert.equal(p.elements.name.value, "Priya Kaur");
  assert.equal(p.elements.notes.value, "Worth a call.");
  assert.equal(p.elements.message.textContent, "");
});

test("a refused re-read keeps whatever was typed by hand", async () => {
  const options = { sidePanel: true, hash: "#panel", injectionError: true };
  const p = await popup(options);
  assert.equal(p.elements.reread.hidden, false);
  await p.edit("name", "Sam Okafor");
  await p.edit("notes", "Met at the plant tour.");
  await p.click("reread");
  assert.equal(p.elements.name.value, "Sam Okafor");
  assert.equal(p.elements.notes.value, "Met at the plant tour.");
  assert.match(p.elements.message.textContent, /toolbar icon/);
});

test("an extension older than the workbench's says so, and says why it waits", async () => {
  const p = await popup({ packagedVersion: "9.9.9" });
  assert.equal(p.elements.update.hidden, false);
  assert.match(p.elements["update-text"].textContent, /Retrivr 9\.9\.9 is ready to download/);
  assert.match(p.elements["update-text"].textContent, new RegExp(`You have ${manifest.version.replace(/\./g, "\.")}`));
  // Chrome will not do it for them, which is the part worth explaining.
  assert.match(p.elements["update-text"].textContent, /does not update an extension you loaded yourself/);
  p.click("update-open");
  // Straight to where the download lives, on the workbench it is connected to.
  assert.equal(p.opened.at(-1), `${config.url}/account`);
});

test("an extension level with the workbench, or ahead of it, says nothing", async () => {
  const level = await popup();
  assert.equal(level.elements.update.hidden, true);
  const ahead = await popup({ packagedVersion: "0.0.1" });
  assert.equal(ahead.elements.update.hidden, true);
  // A version neither side can parse is no reason to nag.
  const odd = await popup({ packagedVersion: "" });
  assert.equal(odd.elements.update.hidden, true);
  const nonsense = await popup({ packagedVersion: "next" });
  assert.equal(nonsense.elements.update.hidden, true);
});

test("the panel's follow switch asks Chrome for LinkedIn when it is turned on, and says nothing else", async () => {
  const p = await popup({ sidePanel: true, hash: "#panel" });
  // Not granted at install, so the switch starts off, with no explanation beside it.
  assert.equal(p.elements.follow.hidden, false);
  assert.equal(p.elements["follow-toggle"].checked, false);
  assert.equal(p.elements["follow-text"], undefined);
  assert.equal(p.elements["follow-allow"], undefined);
  assert.equal(p.permissionAsks.filter((ask) => ask.kind === "request").length, 0);

  await p.toggle("follow-toggle", true);
  const asked = p.permissionAsks.filter((ask) => ask.kind === "request");
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].origins, ["https://*.linkedin.com/*"]);
  assert.equal(p.stored.autoRead, true);
  assert.equal(p.elements["follow-toggle"].checked, true);
});

test("once LinkedIn is allowed, following is on by default", async () => {
  const p = await popup({ sidePanel: true, hash: "#panel", linkedInGranted: true });
  assert.equal(p.stored.autoRead, undefined);
  assert.equal(p.elements["follow-toggle"].checked, true);
});

test("the popup has no follow switch: following is the panel's", async () => {
  const p = await popup({ linkedInGranted: true });
  assert.equal(p.elements.follow.hidden, true);
});

test("refusing the permission puts the switch back off and changes nothing else", async () => {
  const p = await popup({ sidePanel: true, hash: "#panel", grantRefused: true });
  await p.toggle("follow-toggle", true);
  assert.equal(p.stored.autoRead, undefined);
  assert.equal(p.elements["follow-toggle"].checked, false);
  assert.match(p.elements.message.textContent, /fine answer/);
});

test("turning the switch off keeps the panel open and stops it reading", async () => {
  const p = await popup({ sidePanel: true, hash: "#panel", linkedInGranted: true });
  assert.equal(p.elements["follow-toggle"].checked, true);
  await p.toggle("follow-toggle", false);
  assert.equal(p.stored.autoRead, false);
  assert.equal(p.elements["follow-toggle"].checked, false);
  // Turned off, it is not asked again: the permission is still Chrome's.
  assert.equal(p.permissionAsks.filter((ask) => ask.kind === "request").length, 0);
  // The panel is still the panel: nothing about it closed.
  assert.equal(p.panel.closed, 0);
  assert.equal(p.elements["panel-close"].hidden, false);
});

test("a page that is not a profile is a quiet wait, not a complaint", async () => {
  const p = await popup({ sidePanel: true, hash: "#panel", linkedInGranted: true });
  await p.navigate({ url: "https://www.linkedin.com/search/results/people/" });
  assert.equal(p.elements.name.value, "");
  assert.equal(p.elements.message.className, "message");
  assert.match(p.elements.message.textContent, /Open someone's profile/);
  assert.equal(p.elements.reread.hidden, true);
});

test("somebody already saved is said so before they are saved again", async () => {
  const existing = {
    status: 200,
    body: { account, roles, existing: {
      id: "cand-1", fullName: "Priya Kaur", stage: "contacted",
      role: { id: "role-a", title: "Finance Analyst", client: "Example client", status: "open" },
    } },
  };
  const p = await popup({ responses: [{ status: 200, body: { account, roles } }, existing] });
  // The lookup asks the workbench about the link on screen, never LinkedIn.
  const lookup = new URL(p.requests.at(-1).url);
  assert.equal(lookup.pathname, "/api/capture");
  assert.equal(lookup.searchParams.get("profileUrl"), "https://www.linkedin.com/in/priya-kaur/");
  assert.equal(p.elements.existing.hidden, false);
  assert.match(p.elements.existing.textContent, /Already saved as Priya Kaur on Finance Analyst \(Example client\)/);
  assert.equal(p.elements["open-existing"].hidden, false);
  // Saying so is not refusing: a second role is a decision the recruiter makes.
  assert.equal(p.elements.save.disabled, false);
});

test("a lookup that fails is not worth a word", async () => {
  const p = await popup({ responses: [
    { status: 200, body: { account, roles } },
    { status: 500, body: { error: "nope" } },
  ] });
  assert.equal(p.elements.existing.hidden, true);
  assert.equal(p.elements.message.textContent, "");
  assert.equal(p.elements.save.disabled, false);
});

test("the panel saves the profile it is showing, exactly as the popup does", async () => {
  const p = await popup({ sidePanel: true, hash: "#panel", responses: [{ status: 200, body: { account, roles } }, { status: 200, body: { account, roles, existing: null } }, { status: 200, body: { account, roles, existing: null } }, saved] });
  await p.navigate(otherProfile);
  await p.edit("notes", "Runs the Leeds site.");
  await p.click("save");
  const body = JSON.parse(p.requests.at(-1).body);
  assert.equal(body.fullName, "Sam Okafor");
  assert.equal(body.profileUrl, "https://www.linkedin.com/in/sam-okafor/");
  assert.equal(body.notes, "Runs the Leeds site.");
  assert.equal(p.elements.save.disabled, true);
});

test("first run does not request data or read a tab until connected", async () => {
  const p = await popup({ stored: {} });
  assert.equal(p.elements.setup.hidden, false);
  assert.equal(p.elements.url.value, deployment);
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
  assert.equal(p.requests.length, 2);
  assert.match(p.requests[1].url, /profileUrl=/);
  assert.equal(p.reads, 1);
});

test("the member id is read from the profile's own Message link, or left empty", async () => {
  // It is not a field: LinkedIn's id is not something anyone would type, and it
  // exists only so the workbench can open the message box instead of the
  // profile later. Nothing extra is read to get it - it is on the page already.
  const p = await popup();
  p.responses.push(saved);
  await p.click("save");
  assert.equal(JSON.parse(p.requests.at(-1).body).memberId, "ACoAAB1234xyz");

  const bare = await popup({ profile: { nodes: { "main h1": "No Message Link" } } });
  bare.responses.push(saved);
  await bare.click("save");
  assert.equal(JSON.parse(bare.requests.at(-1).body).memberId, "");
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
      profileUrl: "www.linkedin.com/in/manual/", notes: "My own judgement", memberId: "",
      email: "", emailFound: false,
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
  assert.equal(p.requests.length, 4);
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
  assert.equal(p.requests.length, 3);
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
  // One roles request, one extraction - and the lookup the extraction leads to.
  assert.equal(p.requests.length, 2);
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
  assert.match(html, /independently of your website login/);
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

test("switching extension keys isolates account role preferences, keeps the draft and reads only once", async () => {
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
  p.responses.push({ status: 401, body: { error: "Extension key revoked." } });
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

// Loading this folder straight from the repository is how the team runs it, and
// it used to offer a workbench nobody is running.
test("an unpackaged build offers the deployment and can actually reach it", async () => {
  const p = await popup({ stored: {} });
  assert.equal(p.elements.url.value, deployment);
  await p.edit("token", config.token);
  await p.click("connect");
  assert.equal(p.requests[0].url, `${deployment}/api/capture`);
  assert.equal(p.elements.capture.hidden, false);
  assert.equal(p.elements["account-origin"].textContent, deployment);
});

// The site moved from onrender.com to its own domain. A new copy loaded over the
// old one keeps the old address in storage: it sends nothing there, and says
// which address it is for.
test("a copy loaded over one for the former address names its own and reaches nothing", async () => {
  const p = await popup({ stored: { ...config, url: "https://capture-workbench.onrender.com" } });
  assert.equal(p.requests.length, 0);
  assert.equal(p.elements.setup.hidden, false);
  assert.ok(p.elements["setup-message"].textContent.includes(deployment));
});

test("an unpackaged build still permits loopback for development", async () => {
  const p = await popup({ stored: { ...config, url: "http://127.0.0.1:3100" } });
  assert.equal(p.requests[0].url, "http://127.0.0.1:3100/api/capture");
  assert.equal(p.elements.capture.hidden, false);
});

test("a loopback package overrides the deployment rather than inheriting it", async () => {
  const p = await popup({ origins: [], configSource: 'globalThis.CAPTURE_WORKBENCH_DEFAULT = "http://localhost:3000";', stored: {} });
  assert.equal(p.elements.url.value, "http://localhost:3000");
  await p.edit("url", deployment);
  await p.edit("token", config.token);
  await p.click("connect");
  assert.equal(p.requests.length, 0, "a loopback package must not reach the deployment");
  assert.match(p.elements["setup-message"].textContent, /localhost|127\.0\.0\.1/);
});

// Disconnecting has to forget the address too, or the workbench typed in once is
// remembered for ever and the build's own default can never be seen again.
test("disconnecting returns to the address this build is for", async () => {
  const p = await popup({ stored: { ...config, url: "http://localhost:3000" } });
  assert.equal(p.elements.url.value, "http://localhost:3000");
  await p.click("settings");
  await p.click("disconnect");
  assert.equal(p.elements.url.value, deployment);
  assert.equal(p.elements.token.value, "");
  assert.equal(p.stored.token, undefined);
  assert.equal(p.stored.url, undefined);
  assert.equal(p.elements.connection.hidden, true);
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
    // The lookup carries a query; everything else about it is the same call.
    const asked = new URL(request.url);
    assert.equal(`${asked.origin}${asked.pathname}`, `${hostedOrigin}/api/capture`);
    assert.equal(request.headers["X-Capture-Token"], config.token);
    assert.equal(request.redirect, "error");
    assert.equal(request.credentials, "omit");
  }
});

// A popup that opens already connected never shows the setup screen, so its
// address box still holds the page's built-in localhost default. Opening the
// role after a save must go to the workbench the key works on, not that box.
test("opening the saved role goes to the connected workbench, not the setup box's default", async () => {
  const p = await popup({ origins: [hostedOrigin], stored: { ...config, url: hostedOrigin } });
  assert.equal(p.elements.url.value, "http://localhost:3000");
  await p.edit("role", "role-a");
  p.responses.push(saved);
  await p.click("save");
  assert.match(p.elements.message.textContent, /Saved Priya Kaur/);
  await p.click("open-role");
  assert.deepEqual(p.opened, [`${hostedOrigin}/roles/role-a`]);
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
  assert.deepEqual(packaged.host_permissions,
    ["http://localhost/*", "http://127.0.0.1/*", "https://workbench.example.test/*"]);
  assert.doesNotMatch(JSON.stringify(packaged.host_permissions), new RegExp(deployment));
  assert.deepEqual(packaged.permissions, ["activeTab", "scripting", "sidePanel", "storage"]);
  for (const key of ["background", "content_scripts", "optional_permissions"]) {
    assert.equal(packaged[key], undefined);
  }
  // The optional LinkedIn origin survives packaging unchanged: it is the whole
  // point of the panel following along, and it is still granted by the
  // recruiter rather than by the package.
  assert.deepEqual(packaged.optional_host_permissions, ["https://*.linkedin.com/*"]);
  assert.equal(packaged.content_security_policy.extension_pages,
    `script-src 'self'; object-src 'self'; connect-src http://localhost:* http://127.0.0.1:* ${hostedOrigin};`);
  assert.doesNotMatch(JSON.stringify(packaged.host_permissions), /linkedin/i);
  assert.doesNotMatch(JSON.stringify({ ...packaged, optional_host_permissions: [] }),
    /unsafe-eval|https:\/\/\*|<all_urls>/i);
  const packagedHtml = await readFile(join(output, "popup.html"), "utf8");
  const packagedSource = await readFile(join(output, "popup.js"), "utf8");
  const configSource = await readFile(join(output, "workbench.js"), "utf8");
  assert.equal(packaged.name, "Retrivr");
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

// --- Find email ---------------------------------------------------------------

const finder = { remaining: 249, quota: 250, trial: false };
const withFinder = (extra = {}) => ({ status: 200, body: { account, roles, emailFinder: finder, ...extra } });

test("Find email asks the workbench, fills the field, counts down and says Found; the save keeps it as found", async () => {
  const p = await popup({ timeout: 0, responses: [withFinder(), withFinder({ existing: null, person: null })] });
  assert.equal(p.elements["find-email"].hidden, false);
  assert.equal(p.elements["email-left"].textContent, "249 of 250 left");
  p.responses.push({ status: 200, body: { id: "lookup-1", status: "pending", remaining: 249 } }, { status: 200, body: { status: "found", email: "priya@example.test", remaining: 248 } });
  await p.click("find-email");
  const started = p.requests.at(-2);
  assert.equal(started.url, "http://localhost:3000/api/capture/email");
  assert.equal(started.method, "POST");
  assert.deepEqual(JSON.parse(started.body), { profileUrl: "https://www.linkedin.com/in/priya-kaur/" });
  assert.equal(p.requests.at(-1).url, "http://localhost:3000/api/capture/email/lookup-1");
  // Never LinkedIn, never Enrow: only the workbench is asked.
  assert.ok(p.requests.every((request) => request.url.startsWith("http://localhost:3000/api/capture")));
  assert.equal(p.elements.email.value, "priya@example.test");
  assert.equal(p.elements["email-note"].textContent, "Found.");
  assert.equal(p.elements["email-note"].className, "note good");
  assert.equal(p.elements["email-left"].textContent, "248 of 250 left");
  assert.equal(p.elements["find-email"].disabled, true);
  p.responses.push(saved);
  await p.click("save");
  const body = JSON.parse(p.requests.at(-1).body);
  assert.equal(body.email, "priya@example.test");
  assert.equal(body.emailFound, true);
});

test("Find email that finds nothing says so in red, that no credit was used, and offers nothing else", async () => {
  const p = await popup({ timeout: 0, responses: [withFinder(), withFinder({ existing: null, person: null })] });
  p.responses.push({ status: 200, body: { id: "lookup-2", status: "pending", remaining: 249 } }, { status: 200, body: { status: "not_found", remaining: 249 } });
  await p.click("find-email");
  assert.equal(p.elements.email.value, "");
  assert.equal(p.elements["email-note"].textContent, "Email cannot be found. No credit was used.");
  assert.equal(p.elements["email-note"].className, "note bad");
  assert.equal(p.elements["email-left"].textContent, "249 of 250 left");
  assert.equal(p.elements["find-email"].disabled, false);
});

test("Find email is greyed out with the reason on hover when no searches are left", async () => {
  const used = { ...finder, remaining: 0 };
  const p = await popup({ responses: [{ status: 200, body: { account, roles, emailFinder: used } }, { status: 200, body: { account, roles, emailFinder: used, existing: null, person: null } }] });
  assert.equal(p.elements["find-email"].disabled, true);
  assert.equal(p.elements["find-email-wrap"].dataset.tip, "You have no email searches left this month.");
  assert.equal(p.elements["email-left"].className, "finder-count empty");
  const before = p.requests.length;
  await p.click("find-email");
  assert.equal(p.requests.length, before);
});

test("an address this account already keeps is shown and not searched for", async () => {
  const p = await popup({ responses: [withFinder(), withFinder({ existing: null, person: { id: "person-a", email: "kept@example.test", doNotContact: false, roles: [] } })] });
  assert.equal(p.elements.email.value, "kept@example.test");
  assert.equal(p.elements["find-email"].disabled, true);
  assert.equal(p.elements["find-email-wrap"].dataset.tip, "This person already has an email saved.");
});

test("without the finder on this plan or server there is no Find email, and the field is a plain email field", async () => {
  const p = await popup();
  assert.equal(p.elements["find-email"].hidden, true);
  assert.equal(p.elements["email-left"].hidden, true);
  assert.equal(p.elements.email.hidden, false);
  await p.edit("email", "typed@example.test");
  p.responses.push(saved);
  await p.click("save");
  const body = JSON.parse(p.requests.at(-1).body);
  assert.equal(body.email, "typed@example.test");
  assert.equal(body.emailFound, false);
});

const atCompany = {
  url: "https://www.linkedin.com/in/priya-kaur/",
  title: "Priya Kaur | LinkedIn",
  nodes: {
    "main h1": "Priya Kaur",
    "main .text-body-medium": "Finance Analyst",
    'button[aria-label^="Current company"]': "Current company: Example Foods Ltd. Click to skip to experience card",
  },
};

test("the company is read from the profile into its own box beside the name", async () => {
  const p = await popup({ profile: atCompany });
  assert.equal(p.elements.company.value, "Example Foods Ltd");
  assert.match(html, /<div class="pair">[\s\S]*id="name"[\s\S]*id="company"[\s\S]*<\/div>\s*<\/div>/);
  // Without the button, "at X" in the headline.
  const q = await popup({ hash: "#panel", linkedInGranted: true, profile: { ...otherProfile, nodes: { ...otherProfile.nodes, "main .text-body-medium": "Plant Manager at Northwind | Ops" } } });
  assert.equal(q.elements.company.value, "Northwind");
  // A new profile with nothing to say empties it.
  await q.navigate({ ...atCompany, nodes: { "main h1": "Priya Kaur", "main .text-body-medium": "Finance Analyst" } });
  assert.equal(q.elements.company.value, "");
});

test("an employment type under Experience is not taken for a company", async () => {
  const selector = 'section:has(> #experience) li .t-14.t-normal > span[aria-hidden="true"]';
  const p = await popup({ profile: { ...atCompany, nodes: { "main h1": "Priya Kaur", [selector]: "Full-time · 3 yrs" } } });
  assert.equal(p.elements.company.value, "");
  const q = await popup({ profile: { ...atCompany, nodes: { "main h1": "Priya Kaur", [selector]: "Contoso · Full-time" } } });
  assert.equal(q.elements.company.value, "Contoso");
});

test("with a company, Find email sends the name and company too, the LinkedIn link first by default", async () => {
  const p = await popup({ timeout: 0, profile: atCompany, responses: [withFinder(), withFinder({ existing: null, person: null })] });
  p.responses.push({ status: 200, body: { status: "found", email: "priya@example.test", remaining: 248 } });
  await p.click("find-email");
  assert.deepEqual(JSON.parse(p.requests.at(-1).body), {
    profileUrl: "https://www.linkedin.com/in/priya-kaur/", fullName: "Priya Kaur", company: "Example Foods Ltd", prefer: "linkedin",
  });
  // A company typed by the recruiter is the one sent.
  const q = await popup({ timeout: 0, responses: [withFinder(), withFinder({ existing: null, person: null })] });
  await q.edit("company", "  Typed Co ");
  q.responses.push({ status: 200, body: { status: "not_found", remaining: 249 } });
  await q.click("find-email");
  assert.equal(JSON.parse(q.requests.at(-1).body).company, "Typed Co");
});

test("Settings chooses the LinkedIn link or the company name first, remembered, without the address lecture", async () => {
  assert.doesNotMatch(html, /Other remote addresses are not allowed/);
  const p = await popup({ timeout: 0, profile: atCompany, responses: [withFinder(), withFinder({ existing: null, person: null })] });
  await p.click("settings");
  assert.equal(p.elements["email-by-linkedin"].checked, true);
  assert.equal(p.elements["email-by-company"].checked, false);
  // LinkedIn link is the default, and the left of the two.
  assert.ok(html.indexOf('id="email-by-linkedin"') < html.indexOf('id="email-by-company"'));
  await p.toggle("email-by-company", true);
  assert.equal(p.stored.emailBy, "company");
  assert.equal(p.elements["email-by-linkedin"].checked, false);
  await p.click("setup-back");
  p.responses.push({ status: 200, body: { status: "not_found", remaining: 249 } });
  await p.click("find-email");
  assert.equal(JSON.parse(p.requests.at(-1).body).prefer, "company");
  // Remembered on the next opening.
  const q = await popup({ stored: { ...config, emailBy: "company" } });
  await q.click("settings");
  assert.equal(q.elements["email-by-company"].checked, true);
});

test("a red warning is words alone, not a box", () => {
  const css = readFileSync(new URL("../extension/popup.css", import.meta.url), "utf8");
  assert.match(css, /\.message\.bad \{ padding: 0; border-color: transparent; background: none; color: var\(--color-bad\); \}/);
  assert.match(css, /--color-bad: #d70218;/);
  assert.match(css, /\.note\.bad \{ color: var\(--color-bad\); \}/);
});
