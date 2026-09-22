"use strict";

// Everything happens in response to the toolbar click that opened this page.
// There is no background script and no content script registered in the
// manifest: the page is read once, here, with activeTab permission that Chrome
// only grants because of that click.
//
// The same page is served twice: as the toolbar popup, which Chrome throws away
// the moment it loses focus, and as the side panel, which stays put while the
// recruiter walks from profile to profile. Everything below is written for both.

const el = (id) => document.getElementById(id);

const state = { url: "", token: "", account: null, roleScope: "", roles: [], profileRead: false, saving: false, saved: false, savedRoleId: "", surface: "popup", profileUrl: "", memberId: "", stale: false };
const fields = ["role", "name", "headline", "profile", "notes"];
const controls = ["settings", "open-role", "reread"];
// Where Capture actually lives. A package built by scripts/package-extension.mjs
// or by the site's own download endpoint declares its origin in workbench.js and
// that declaration wins, including the empty one a loopback build ships. Loading
// this folder straight from the repository declares nothing, so it falls back to
// the deployment rather than to a workbench nobody is running.
const WORKBENCH_ORIGINS = ["https://capture-workbench.onrender.com"];
const hostedOrigins = (Array.isArray(globalThis.CAPTURE_WORKBENCH_ORIGINS)
  ? globalThis.CAPTURE_WORKBENCH_ORIGINS : WORKBENCH_ORIGINS).filter((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && value === url.origin && !url.username && !url.password;
  } catch {
    return false;
  }
});
const addressError = `Use ${hostedOrigins.length ? `${hostedOrigins.join(" or ")}, or ` : ""}an http://localhost or http://127.0.0.1 address with an optional port, but no path, query, fragment or login details.`;

// --- reading the open tab ---------------------------------------------------

// Runs inside the page. Kept defensive on purpose: LinkedIn's markup changes,
// and a missed field should mean an empty box the recruiter types into, never
// a broken save.
function readProfile() {
  const clean = (text) => (text || "").replace(/\s+/g, " ").trim();

  // Strip tracking parameters and trailing segments so the same person always
  // produces the same URL, which is what the workbench's duplicate check uses.
  const match = location.pathname.match(/^\/in\/([^/]+)/);
  const isProfile = /(^|\.)linkedin\.com$/.test(location.hostname) && Boolean(match);
  const profileUrl = isProfile ? `https://${location.hostname}/in/${match[1]}/` : "";
  if (!isProfile) return { profileUrl, name: "", headline: "", memberId: "", isProfile };

  const heading = document.querySelector("main h1") || document.querySelector("h1");
  let name = clean(heading && heading.textContent);

  // Fallback: the tab title is "Name | LinkedIn", sometimes with a leading
  // notification count.
  if (!name) {
    name = clean(document.title.replace(/^\(\d+\+?\)\s*/, "").split("|")[0]);
  }

  let headline = "";
  const headlineNode = document.querySelector("main .text-body-medium");
  if (headlineNode) headline = clean(headlineNode.textContent);
  if (!headline) {
    const meta = document.querySelector('meta[name="description"]');
    if (meta) headline = clean(meta.getAttribute("content")).slice(0, 160);
  }

  // LinkedIn's own id for this member. The profile's own Message link carries
  // it, which is the one address that opens the message box directly later on.
  // Read from the page that is already open, on the same click; nothing extra
  // is fetched, and a missing id only means the profile gets opened instead.
  let memberId = "";
  const compose = document.querySelector('a[href*="/messaging/compose/"]');
  if (compose) {
    const recipient = (compose.getAttribute("href").match(/[?&]recipient=([^&#]+)/) || [])[1];
    if (recipient && /^[A-Za-z0-9_-]{5,60}$/.test(recipient)) memberId = recipient;
  }

  return { profileUrl, name, headline, memberId, isProfile };
}

async function readActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return null;
    // Which tab the fields on screen describe, so a load finishing in some
    // other tab cannot be mistaken for this one moving on.
    state.tabId = tab.id;
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readProfile,
    });
    return result ? result.result : null;
  } catch {
    // Chrome refuses to inject into its own pages and the Web Store.
    return null;
  }
}

// --- popup or side panel ----------------------------------------------------

// Chrome keeps a side panel open while the recruiter navigates, which is the
// whole point of offering one: Paul walks a search result list and the panel is
// already there on every profile. It costs one permission and no page access -
// there is still no content script, no background page and no LinkedIn host
// permission, and a profile is still only read on a click.

// The panel is opened at this address so that it can recognise itself on load.
const PANEL_PATH = "popup.html#panel";

// Older browsers, and the tests, have no sidePanel API. Everything about the
// panel is optional: without it this page is exactly the popup it always was.
function sidePanelApi() {
  try {
    return chrome.sidePanel && typeof chrome.sidePanel.open === "function" ? chrome.sidePanel : null;
  } catch {
    return null;
  }
}

async function remember(values) {
  try {
    await chrome.storage.local.set(values);
  } catch {
    // A forgotten preference is not worth interrupting anyone for.
  }
}

async function recall(keys) {
  try {
    return (await chrome.storage.local.get(keys)) || {};
  } catch {
    return {};
  }
}

// Which of the two surfaces this page is. The hash is how the panel is opened
// from here; the context check catches a panel opened from Chrome's own side
// panel menu, where nothing of ours put a hash on the address.
async function detectSurface() {
  if (globalThis.location && globalThis.location.hash === "#panel") return "panel";
  if (!sidePanelApi()) return "popup";
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["POPUP"] });
    if (Array.isArray(contexts) && contexts.length === 0) return "panel";
  } catch {
    // Not a browser that can tell us. Assume the popup, which needs nothing.
  }
  return "popup";
}

// Whichever message line the visible screen owns.
function statusNode() {
  return el("setup").hidden ? el("message") : el("setup-message");
}

async function applySurface() {
  state.surface = await detectSurface();
  const panel = sidePanelApi();
  const inPanel = state.surface === "panel";
  el("page").className = inPanel ? "surface-panel" : "";
  el("eyebrow").hidden = inPanel;
  el("panel-open").hidden = inPanel || !panel;
  el("panel-close").hidden = !inPanel;
  if (panel) {
    // Make sure the next panel Chrome opens - including one opened from its own
    // menu after a restart - arrives at an address that identifies itself.
    try {
      await panel.setOptions({ path: PANEL_PATH, enabled: true });
    } catch {
      // Then it falls back to the context check above.
    }
  }
  if (inPanel) {
    watchTabs();
    await remember({ panelPinned: true });
    return;
  }
  if (panel) {
    const stored = await recall(["panelPinned"]);
    el("panel-open").textContent = stored.panelPinned ? "Show panel" : "Keep open";
  }
}

// --- keeping the panel honest about which page it is looking at --------------

// The popup dies between profiles, so it can only ever show the page it was
// opened on. The panel outlives the page it read, which is a new way to be
// wrong: the fields would still describe the last person while the recruiter
// looks at the next one. So the panel watches for the tab moving and clears
// what it can no longer vouch for.
let watchingTabs = false;

function watchTabs() {
  if (watchingTabs) return;
  watchingTabs = true;
  // Chrome ignores what a tab listener returns; the promise is handed back so
  // that a caller which can wait - the tests - is able to.
  const moved = () => refreshProfile();
  try {
    chrome.tabs.onActivated.addListener(moved);
  } catch {
    watchingTabs = false;
  }
  try {
    chrome.tabs.onUpdated.addListener((tabId, info) => (
      info && info.status === "complete" && tabId === state.tabId ? moved() : undefined
    ));
  } catch {
    // One of the two is enough to notice most moves; neither is a silent save.
  }
}

function applyProfile(profile) {
  state.stale = false;
  state.saved = false;
  state.savedRoleId = "";
  state.profileUrl = profile.profileUrl || "";
  state.memberId = profile.memberId || "";
  el("open-role").hidden = true;
  el("reread").hidden = true;
  el("name").value = profile.name || "";
  el("headline").value = profile.headline || "";
  el("profile").value = profile.profileUrl || "";
  el("save").disabled = false;
  if (!profile.isProfile) {
    say(el("message"), "This does not look like a profile page. Check the details before saving.", "bad");
  } else if (!profile.name) {
    say(el("message"), "No name found on the page. Type one in.", "bad");
  } else {
    say(el("message"), "", "");
  }
}

// Called when the panel can no longer read the page. `clear` empties the fields
// taken off the page: once the tab has moved they describe somebody who is no
// longer on screen, and saving them against whoever is would be a quiet lie.
// The note is never cleared here - it is the one thing the recruiter typed, and
// a note with no name attached cannot be saved against the wrong person anyway.
function markStale(message, { clear = false } = {}) {
  state.stale = true;
  state.saved = false;
  state.savedRoleId = "";
  el("open-role").hidden = true;
  el("reread").hidden = false;
  el("save").disabled = false;
  if (clear) {
    state.profileUrl = "";
    state.memberId = "";
    for (const id of ["name", "headline", "profile"]) el(id).value = "";
  }
  say(el("message"), message, "bad");
}

async function refreshProfile() {
  if (el("capture").hidden || state.saving) return;
  const profile = await readActiveTab();
  if (!profile) {
    markStale("This is a different page now, and Chrome only lets Capture read a page just after you click its toolbar icon. Click the icon, then Read this profile.", { clear: true });
    return;
  }
  if (profile.profileUrl && profile.profileUrl === state.profileUrl && !state.stale) return;
  applyProfile(profile);
  el("notes").value = "";
}

// --- talking to the workbench ----------------------------------------------

function workbenchOrigin(value) {
  try {
    const url = new URL(value);
    if (typeof value !== "string" || !/^https?:\/\/[^/?#\\@\s]+\/?$/.test(value) ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash) return "";
    const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    return loopback || (url.protocol === "https:" && hostedOrigins.includes(url.origin)) ? url.origin : "";
  } catch {
    return "";
  }
}

async function api(path, options = {}) {
  const origin = workbenchOrigin(state.url);
  if (!origin) return { ok: false, status: 0, body: { error: addressError } };
  // A hosted workbench can be asleep: free tiers spin an idle instance down and
  // take most of a minute to answer the request that wakes it. A loopback dev
  // server either answers at once or is not running at all, so it keeps the
  // short timeout that makes "start your server" obvious quickly.
  const hosted = origin.startsWith("https:");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), hosted ? 60000 : 10000);
  try {
    const response = await fetch(`${origin}${path}`, {
      ...options,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Capture-Token": state.token,
      },
    });
    let body = {};
    try {
      const parsed = await response.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed;
    } catch {
      // fall through with an empty body
    }
    // A host that is still starting answers from its own front door rather than
    // from the app: a gateway status and a page, not the JSON error the app
    // would have sent. Saying "not reachable" there would send people looking
    // for a problem that fixes itself.
    if (!response.ok && !body.error && [502, 503, 504].includes(response.status)) {
      body = { error: `The workbench is not ready yet (${response.status}). If it is waking up or has just been deployed, wait a moment and try again.` };
    }
    return { ok: response.ok, status: response.status, body };
  } catch {
    return {
      ok: false,
      status: 0,
      body: {
        error: hosted
          ? "Could not reach the workbench. A sleeping hosted workbench can take a minute to wake up, so try again. If you were saving, check the role before retrying."
          : "Could not reach the workbench. Check that it is running at this address. If you were saving, check the role before retrying.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function say(node, text, tone) {
  node.textContent = text;
  node.className = `message${tone ? ` ${tone}` : ""}`;
}

// --- screens ----------------------------------------------------------------

// Opening the workbench is a convenience, never a requirement: the popup keeps
// working if the browser refuses the new tab.
function openWorkbench(path) {
  const origin = workbenchOrigin(el("url").value.trim() || state.url);
  if (!origin) {
    say(el("setup-message"), addressError, "bad");
    return;
  }
  try {
    chrome.tabs.create({ url: `${origin}${path}` });
  } catch {
    say(el("setup-message"), `Could not open a tab. Go to ${origin}${path} yourself.`, "bad");
  }
}

function showSetup(message) {
  el("capture").hidden = true;
  el("setup").hidden = false;
  el("url").value = state.url || hostedOrigins[0] || workbenchOrigin(globalThis.CAPTURE_WORKBENCH_DEFAULT) || "http://localhost:3000";
  el("token").value = state.token || "";
  // Settings is a detour, not a dead end: offer the way back only while there
  // is a connected account with roles to go back to.
  const connected = Boolean(state.account) && state.roles.length > 0;
  el("setup-back").hidden = !connected;
  el("disconnect").hidden = !state.token;
  say(el("setup-message"), message, message ? "bad" : "");
}

function clearAccount() {
  state.account = null;
  state.roles = [];
  state.savedRoleId = "";
  el("open-role").hidden = true;
  el("connection").hidden = true;
  el("account-name").textContent = "";
  el("account-email").textContent = "";
  el("account-origin").textContent = "";
}

function roleStorageKey() {
  return `lastRole:${JSON.stringify([workbenchOrigin(state.url), state.account.id])}`;
}

async function rejectKey(message) {
  state.token = "";
  clearAccount();
  showSetup(`${message || "That key was refused."} Paste the capture key from Settings again.`);
  await chrome.storage.local.remove("token");
  el("token").focus();
}

async function showCapture() {
  const roleSelect = el("role");
  const scope = roleStorageKey();
  const sameAccount = state.roleScope === scope;
  const previousRoleId = sameAccount ? roleSelect.value : "";
  if (!sameAccount) {
    state.saved = false;
    state.savedRoleId = "";
    el("open-role").hidden = true;
    say(el("message"), "", "");
  }
  state.roleScope = scope;
  roleSelect.innerHTML = "";
  for (const role of state.roles) {
    const option = document.createElement("option");
    option.value = role.id;
    option.textContent = role.client ? `${role.title} (${role.client})` : role.title;
    roleSelect.append(option);
  }

  const stored = await chrome.storage.local.get(scope);
  const preferredRole = [previousRoleId, stored[scope]].find((id) => state.roles.some((role) => role.id === id));
  if (preferredRole) roleSelect.value = preferredRole;

  if (!state.profileRead) {
    state.profileRead = true;
    const profile = await readActiveTab();
    if (!profile) {
      say(el("message"), "Could not read this tab. Type the details in and save.", "bad");
      el("reread").hidden = false;
    } else {
      applyProfile(profile);
    }
  }

  el("setup").hidden = true;
  el("capture").hidden = false;
  el("save").disabled = state.saving || state.saved;
  el("notes").focus();
}

async function loadRolesAndShow() {
  clearAccount();
  const { ok, status, body } = await api("/api/capture");
  if (!ok) {
    if (status === 401) await rejectKey(body.error);
    else showSetup(body.error || `Could not reach the workbench (${status || "no response"}). Is it running?`);
    return;
  }
  if (!Array.isArray(body.roles) || !body.roles.every((role) =>
    role && typeof role.id === "string" && role.id && typeof role.title === "string")) {
    showSetup("The workbench returned an invalid role list. Check the address and restart the workbench.");
    return;
  }
  const account = body.account;
  if (!account || typeof account.id !== "string" || !account.id.trim() ||
      typeof account.email !== "string" || !account.email.trim() ||
      !(account.name === null || typeof account.name === "string")) {
    showSetup("The workbench returned an invalid account. Check the address and reconnect with your personal capture key.");
    return;
  }
  state.account = account;
  state.roles = body.roles;
  el("account-name").textContent = account.name?.trim() || account.email;
  el("account-email").textContent = account.email;
  el("account-origin").textContent = workbenchOrigin(state.url);
  el("connection").hidden = false;
  if (state.roles.length === 0) {
    showSetup("No open roles for this account yet. Create one in this account, then try again.");
    return;
  }
  await showCapture();
}

// --- wiring -----------------------------------------------------------------

el("connect").addEventListener("click", async () => {
  const button = el("connect");
  if (button.disabled) return;
  const url = workbenchOrigin(el("url").value.trim());
  const token = el("token").value.trim();
  if (!url || !token) {
    say(el("setup-message"), !url ? addressError : "Both the address and the key are needed.", "bad");
    return;
  }
  button.disabled = true;
  state.url = url;
  state.token = token;
  clearAccount();
  try {
    await chrome.storage.local.set({ url, token });
    say(el("setup-message"), "Connecting...", "");
    await loadRolesAndShow();
  } catch {
    showSetup("Could not access extension storage. Reopen the extension and connect again.");
  } finally {
    button.disabled = false;
  }
});

// Opening the panel is a click of its own, because Chrome only lets an
// extension open one in answer to a gesture. After that it stays until it is
// closed, across every profile the recruiter walks through.
el("panel-open").addEventListener("click", async () => {
  const panel = sidePanelApi();
  if (!panel) return;
  try {
    await panel.setOptions({ path: PANEL_PATH, enabled: true });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // A panel opened for the window follows the recruiter from tab to tab; one
    // opened for a single tab does not, so the window is what we ask for.
    const target = tab && tab.windowId !== undefined ? { windowId: tab.windowId } : { tabId: tab && tab.id };
    if (target.windowId === undefined && target.tabId === undefined) throw new Error("No window to open in");
    await panel.open(target);
    await remember({ panelPinned: true });
    // Chrome closes this popup by itself as the panel takes focus.
  } catch {
    say(statusNode(), "Could not open the side panel. This popup still works, and Chrome's own side panel menu can open Capture too.", "bad");
  }
});

// The panel closes itself. Chrome's own X does the same thing, and either way
// the toolbar icon brings it back.
el("panel-close").addEventListener("click", async () => {
  await remember({ panelPinned: false });
  try {
    globalThis.close();
  } catch {
    say(statusNode(), "Could not close the panel from here. Use the X at the top of the side panel.", "bad");
  }
});

el("reread").addEventListener("click", async () => {
  if (state.saving) return;
  say(el("message"), "Reading this page...", "");
  const profile = await readActiveTab();
  if (!profile) {
    markStale("Chrome only lets Capture read a page just after you click its toolbar icon. Click the icon, then press Read this profile again.");
    return;
  }
  applyProfile(profile);
});

el("settings").addEventListener("click", () => showSetup(""));

el("setup-back").addEventListener("click", async () => {
  if (!state.account || state.roles.length === 0) return;
  await showCapture();
});

el("open-settings").addEventListener("click", () => openWorkbench("/settings"));

el("open-role").addEventListener("click", () => {
  if (state.savedRoleId) openWorkbench(`/roles/${encodeURIComponent(state.savedRoleId)}`);
});

// Disconnecting drops the address as well as the key. Otherwise a workbench
// typed in once - a colleague's dev server, an old deployment - is remembered
// for ever, and the address this build is actually for can never be seen again.
el("disconnect").addEventListener("click", async () => {
  state.token = "";
  state.url = "";
  state.roleScope = "";
  clearAccount();
  try {
    await chrome.storage.local.remove(["token", "url"]);
    showSetup("Disconnected. Check the address and paste a capture key to connect again.");
  } catch {
    showSetup("Could not access extension storage. Reopen the extension and connect again.");
  }
  el("token").focus();
});

for (const id of fields) {
  const edited = () => {
    state.saved = false;
    el("open-role").hidden = true;
    el("save").disabled = state.saving;
  };
  el(id).addEventListener("input", edited);
  el(id).addEventListener("change", edited);
}

el("save").addEventListener("click", async () => {
  if (state.saving || state.saved || !state.account || state.roleScope !== roleStorageKey()) return;
  const button = el("save");
  state.saving = true;
  button.disabled = true;
  for (const id of [...fields, ...controls]) el(id).disabled = true;
  say(el("message"), "Saving...", "");

  const roleId = el("role").value;
  try {
    const { ok, status, body } = await api("/api/capture", {
      method: "POST",
      body: JSON.stringify({
        roleId,
        fullName: el("name").value,
        headline: el("headline").value,
        profileUrl: el("profile").value,
        // Not shown as a field: it is LinkedIn's id, not something to type.
        memberId: state.memberId || "",
        notes: el("notes").value,
      }),
    });

    if (status === 201 && body.ok === true && typeof body.fullName === "string") {
      state.saved = true;
      el("notes").value = "";
      let warning = body.warning || "";
      try {
        await chrome.storage.local.set({ [roleStorageKey()]: roleId });
      } catch {
        warning = `${warning} Could not remember this role. Select it again next time.`.trim();
      }
      state.savedRoleId = roleId;
      el("open-role").hidden = false;
      say(el("message"), `Saved ${body.fullName}.${warning ? ` ${warning}` : ""}`, warning ? "bad" : "good");
    } else if (status === 401) {
      await rejectKey(body.error);
    } else {
      say(el("message"), body.error || (ok
        ? "Unexpected save response. Check the role in the workbench before trying again."
        : `Could not save (${status}).`), "bad");
      if (status === 404) await loadRolesAndShow();
    }
  } catch {
    showSetup("Could not access extension storage. Reopen the extension and connect again.");
  } finally {
    state.saving = false;
    for (const id of [...fields, ...controls]) el(id).disabled = false;
    button.disabled = state.saved;
  }
});

(async function start() {
  await applySurface();
  try {
    const stored = await chrome.storage.local.get(["url", "token"]);
    state.url = stored.url || "";
    state.token = stored.token || "";
    if (!state.url || !state.token) {
      showSetup("");
      return;
    }
    await loadRolesAndShow();
  } catch {
    showSetup("Could not access extension storage. Reopen the extension and connect again.");
  }
})();
