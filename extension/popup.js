"use strict";

// Everything happens in response to the toolbar click that opened this popup.
// There is no background script and no content script registered in the
// manifest: the page is read once, here, with activeTab permission that Chrome
// only grants because of that click.

const el = (id) => document.getElementById(id);

const state = { url: "", token: "", account: null, roleScope: "", roles: [], profileRead: false, saving: false, saved: false };
const fields = ["role", "name", "headline", "profile", "notes"];
const hostedOrigins = (Array.isArray(globalThis.CAPTURE_WORKBENCH_ORIGINS)
  ? globalThis.CAPTURE_WORKBENCH_ORIGINS : []).filter((value) => {
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
  if (!isProfile) return { profileUrl, name: "", headline: "", isProfile };

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

  return { profileUrl, name, headline, isProfile };
}

async function readActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return null;
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
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
    return { ok: response.ok, status: response.status, body };
  } catch {
    return {
      ok: false,
      status: 0,
      body: { error: "Could not reach the workbench. Check that it is running at this address. If you were saving, check the role before retrying." },
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

function showSetup(message) {
  el("capture").hidden = true;
  el("setup").hidden = false;
  el("url").value = state.url || hostedOrigins[0] || "http://localhost:3000";
  el("token").value = state.token || "";
  say(el("setup-message"), message, message ? "bad" : "");
}

function clearAccount() {
  state.account = null;
  state.roles = [];
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
    } else {
      el("name").value = profile.name || "";
      el("headline").value = profile.headline || "";
      el("profile").value = profile.profileUrl || "";
      if (!profile.isProfile) {
        say(el("message"), "This does not look like a profile page. Check the details before saving.", "bad");
      } else if (!profile.name) {
        say(el("message"), "No name found on the page. Type one in.", "bad");
      }
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

el("settings").addEventListener("click", () => showSetup(""));

for (const id of fields) {
  const edited = () => {
    state.saved = false;
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
  for (const id of [...fields, "settings"]) el(id).disabled = true;
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
    for (const id of [...fields, "settings"]) el(id).disabled = false;
    button.disabled = state.saved;
  }
});

(async function start() {
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
