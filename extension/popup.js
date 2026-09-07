"use strict";

// Everything happens in response to the toolbar click that opened this popup.
// There is no background script and no content script registered in the
// manifest: the page is read once, here, with activeTab permission that Chrome
// only grants because of that click.

const el = (id) => document.getElementById(id);

const state = { url: "", token: "", roles: [] };

// --- reading the open tab ---------------------------------------------------

// Runs inside the page. Kept defensive on purpose: LinkedIn's markup changes,
// and a missed field should mean an empty box the recruiter types into, never
// a broken save.
function readProfile() {
  const clean = (text) => (text || "").replace(/\s+/g, " ").trim();

  // Strip tracking parameters and trailing segments so the same person always
  // produces the same URL, which is what the workbench's duplicate check uses.
  let profileUrl = location.href;
  const match = location.pathname.match(/\/in\/([^/]+)/);
  if (match) profileUrl = `${location.origin}/in/${match[1]}/`;

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

  const isProfile = /\/in\//.test(location.pathname);
  return { profileUrl, name, headline, isProfile };
}

async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return null;
  try {
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

async function api(path, options = {}) {
  const response = await fetch(`${state.url.replace(/\/+$/, "")}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Capture-Token": state.token,
      ...(options.headers || {}),
    },
  });
  let body = {};
  try {
    body = await response.json();
  } catch {
    // fall through with an empty body
  }
  return { ok: response.ok, status: response.status, body };
}

function say(node, text, tone) {
  node.textContent = text;
  node.className = `message${tone ? ` ${tone}` : ""}`;
}

// --- screens ----------------------------------------------------------------

function showSetup(message) {
  el("capture").hidden = true;
  el("setup").hidden = false;
  el("url").value = state.url || "http://localhost:3000";
  el("token").value = state.token || "";
  if (message) say(el("setup-message"), message, "bad");
}

async function showCapture() {
  el("setup").hidden = true;
  el("capture").hidden = false;

  const roleSelect = el("role");
  roleSelect.innerHTML = "";
  for (const role of state.roles) {
    const option = document.createElement("option");
    option.value = role.id;
    option.textContent = role.client ? `${role.title} (${role.client})` : role.title;
    roleSelect.append(option);
  }

  const { lastRoleId } = await chrome.storage.local.get("lastRoleId");
  if (lastRoleId && state.roles.some((role) => role.id === lastRoleId)) {
    roleSelect.value = lastRoleId;
  }

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

  el("notes").focus();
}

async function loadRolesAndShow() {
  const { ok, status, body } = await api("/api/capture");
  if (!ok) {
    showSetup(
      status === 401
        ? "That key was refused. Generate a new one in Settings and paste it again."
        : `Could not reach the workbench (${status || "no response"}). Is it running?`
    );
    return;
  }
  state.roles = body.roles || [];
  if (state.roles.length === 0) {
    showSetup("No open roles in the workbench yet. Create one, then try again.");
    return;
  }
  await showCapture();
}

// --- wiring -----------------------------------------------------------------

el("connect").addEventListener("click", async () => {
  state.url = el("url").value.trim();
  state.token = el("token").value.trim();
  if (!state.url || !state.token) {
    say(el("setup-message"), "Both the address and the key are needed.", "bad");
    return;
  }
  await chrome.storage.local.set({ url: state.url, token: state.token });
  say(el("setup-message"), "Connecting...", "");
  await loadRolesAndShow();
});

el("settings").addEventListener("click", () => showSetup(""));

el("save").addEventListener("click", async () => {
  const button = el("save");
  button.disabled = true;
  say(el("message"), "Saving...", "");

  const roleId = el("role").value;
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

  if (ok) {
    await chrome.storage.local.set({ lastRoleId: roleId });
    say(el("message"), body.warning || `Saved ${body.fullName}.`, body.warning ? "bad" : "good");
    el("notes").value = "";
  } else {
    say(el("message"), body.error || `Could not save (${status}).`, "bad");
    button.disabled = false;
  }
});

(async function start() {
  const stored = await chrome.storage.local.get(["url", "token"]);
  state.url = stored.url || "";
  state.token = stored.token || "";
  if (!state.url || !state.token) {
    showSetup("");
    return;
  }
  await loadRolesAndShow();
})();
