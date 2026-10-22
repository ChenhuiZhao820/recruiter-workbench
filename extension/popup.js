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

const state = { url: "", token: "", account: null, roleScope: "", roles: [], profileRead: false, saving: false, saved: false, savedRoleId: "", surface: "popup", profileUrl: "", memberId: "", stale: false, existingRoleId: "", filled: { name: "", headline: "" }, waiting: false, leftName: "", settleUrl: "", settleTries: 0, finder: null, found: "", kept: false, finding: false, findRun: 0 };
const fields = ["role", "name", "headline", "profile", "email", "notes"];
const controls = ["settings", "open-role", "reread", "find-email"];
// Where Retrivr actually lives. A package built by scripts/package-extension.mjs
// or by the site's own download endpoint declares its origin in workbench.js and
// that declaration wins, including the empty one a loopback build ships. Loading
// this folder straight from the repository declares nothing, so it falls back to
// the deployment rather than to a workbench nobody is running.
const WORKBENCH_ORIGINS = ["https://retrivr.app"];
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
  if (!isProfile) return { profileUrl, name: "", headline: "", memberId: "", isProfile, settled: true };

  const heading = document.querySelector("main h1") || document.querySelector("h1");
  let name = clean(heading && heading.textContent);

  // The tab title is "Name | LinkedIn", sometimes with a leading notification
  // count.
  const titleName = clean(document.title.replace(/^\(\d+\+?\)\s*/, "").split("|")[0]);
  if (!name) name = titleName;

  // Between two profiles the address already names the next person while the
  // heading or the title still shows the last one. When the two disagree the
  // page is half drawn, and whatever is on it may be somebody else's.
  const fold = (text) => text.toLocaleLowerCase();
  const settled = !document.title.includes("|") || !titleName ||
    fold(titleName).includes(fold(name)) || fold(name).includes(fold(titleName));

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

  return { profileUrl, name, headline, memberId, isProfile, settled };
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

// --- being out of date ------------------------------------------------------
//
// Chrome updates extensions it installed; it does not update one loaded by
// hand, which is how this one arrives. So an old copy can go on working
// quietly for months while the workbench has a newer one to hand out. The
// workbench reports what it would package now, and this says so once, here,
// where the recruiter already is.

function installedVersion() {
  try {
    const manifest = chrome.runtime.getManifest();
    return typeof manifest.version === "string" ? manifest.version : "";
  } catch {
    return "";
  }
}

// Numeric, part by part, so 1.10.0 is newer than 1.9.0. Anything unparseable
// means no opinion, which is the right amount of opinion to have about it.
function isOlder(installed, available) {
  if (!/^[0-9]+(\.[0-9]+)*$/.test(installed) || !/^[0-9]+(\.[0-9]+)*$/.test(available)) return false;
  const mine = installed.split(".").map(Number);
  const theirs = available.split(".").map(Number);
  for (let i = 0; i < Math.max(mine.length, theirs.length); i++) {
    const a = mine[i] || 0;
    const b = theirs[i] || 0;
    if (a !== b) return a < b;
  }
  return false;
}

function showUpdate(available) {
  const installed = installedVersion();
  const behind = isOlder(installed, available);
  el("update").hidden = !behind;
  if (behind) {
    el("update-text").textContent = `Retrivr ${available} is ready to download. You have ${installed}. Chrome does not update an extension you loaded yourself, so this one waits for you.`;
  }
}

// --- following the recruiter from profile to profile ------------------------
//
// `activeTab` is granted by a toolbar click and taken back the moment the tab
// navigates, so a panel that outlives the page cannot read the next one. That
// is the click Paul was making on every profile.
//
// The way out is a permission he grants himself, once: LinkedIn is declared as
// an OPTIONAL origin, so it is not part of what the extension asks for at
// install, it is requested from a button here, and Chrome lets him take it
// back at any time. Nothing else changes. There is still no registered content
// script - the reader is injected on demand and only while the panel is open -
// no request is ever made to LinkedIn, nothing on the page is written to, and
// nothing leaves the browser until he presses Save.

const LINKEDIN_ORIGIN = "https://*.linkedin.com/*";

async function mayFollow() {
  try {
    return await chrome.permissions.contains({ origins: [LINKEDIN_ORIGIN] });
  } catch {
    return false;
  }
}

// Off means the panel stays where it is and stops reading. It is a pause, not
// a revocation: the permission is Chrome's to hold and his to remove.
async function followingEnabled() {
  if (!(await mayFollow())) return false;
  const stored = await recall(["autoRead"]);
  return stored.autoRead !== false;
}

// One switch, in the panel only. It is on whenever the panel follows: Chrome
// has allowed LinkedIn and it has not been turned off. Following is the
// default once allowed; allowing still takes the recruiter's own click, on
// this switch, because the permission is optional and never granted at
// install.
async function showFollowState() {
  el("follow").hidden = state.surface !== "panel";
  el("follow-toggle").checked = await followingEnabled();
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
  // LinkedIn walks from one profile to the next without loading a page: the
  // address changes first and the person on it is drawn a moment later, with
  // the tab's title last. So a new address, a new title or a finished load in
  // the tab being read is each a reason to look again.
  try {
    chrome.tabs.onUpdated.addListener((tabId, info) => (
      info && tabId === state.tabId && (info.status === "complete" || info.url || info.title) ? moved() : undefined
    ));
  } catch {
    // One of the two is enough to notice most moves; neither is a silent save.
  }
}

function applyProfile(profile, { quiet = false } = {}) {
  state.stale = false;
  state.saved = false;
  state.savedRoleId = "";
  state.profileUrl = profile.profileUrl || "";
  state.memberId = profile.memberId || "";
  state.waiting = false;
  el("open-role").hidden = true;
  el("reread").hidden = true;
  el("name").value = profile.name || "";
  el("headline").value = profile.headline || "";
  el("profile").value = profile.profileUrl || "";
  state.filled = { name: el("name").value, headline: el("headline").value };
  resetEmail();
  el("save").disabled = false;
  if (!profile.isProfile) {
    // While the panel follows along, most pages are not profiles: a search
    // result list, an inbox, somebody's feed. That is not a fault to report.
    say(el("message"), quiet
      ? "Open someone's profile and their details appear here."
      : "This does not look like a profile page. Check the details before saving.", quiet ? "" : "bad");
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
    state.filled = { name: "", headline: "" };
    state.waiting = false;
    pageSettled();
    for (const id of ["name", "headline", "profile"]) el(id).value = "";
    resetEmail();
  }
  say(el("message"), message, "bad");
}

// One move reports itself several times - a new address, a new title, a
// finished load - so reads are taken one at a time, and a move reported during
// a read is looked at again once it is done rather than raced against it.
let refreshing = null;
let refreshAgain = false;

function refreshProfile() {
  if (refreshing) {
    refreshAgain = true;
    return refreshing;
  }
  refreshing = (async () => {
    do {
      refreshAgain = false;
      await refreshOnce();
    } while (refreshAgain);
  })().finally(() => { refreshing = null; });
  return refreshing;
}

// A half-drawn profile is looked at again shortly, a few times at most, and
// only for the page the recruiter has just moved to. If it never settles the
// choice goes back to them: Read this profile takes the page as it is.
const SETTLE_DELAY = 700;
const SETTLE_TRIES = 3;
let settleTimer = null;

function waitForPage(profileUrl) {
  if (state.settleUrl !== profileUrl) {
    state.settleUrl = profileUrl;
    state.settleTries = 0;
  }
  clearTimeout(settleTimer);
  if (state.settleTries >= SETTLE_TRIES) {
    el("reread").hidden = false;
    say(el("message"), "This profile has not finished loading. Check the name, or press Read this profile.", "bad");
    return;
  }
  state.settleTries += 1;
  settleTimer = setTimeout(() => refreshProfile(), SETTLE_DELAY);
}

function pageSettled() {
  clearTimeout(settleTimer);
  state.settleUrl = "";
  state.settleTries = 0;
}

// The same person, read again once the page has finished drawing them. Only
// what still reads as it was filled in is replaced: a name the recruiter
// corrected is theirs, and so is the note.
function updateProfile(profile) {
  let changed = false;
  for (const id of ["name", "headline"]) {
    const value = profile[id] || "";
    if (el(id).value === state.filled[id] && value !== state.filled[id]) {
      el(id).value = value;
      state.filled[id] = value;
      changed = true;
    }
  }
  // Not a field anyone types, so it is always the page's: an id kept from an
  // earlier read could open the last person's message box.
  state.memberId = profile.memberId || "";
  if (state.waiting) {
    state.waiting = false;
    el("reread").hidden = true;
    say(el("message"), profile.name ? "" : "No name found on the page. Type one in.", profile.name ? "" : "bad");
  } else if (changed && !state.saved) {
    say(el("message"), "", "");
  }
}

async function refreshOnce() {
  if (el("capture").hidden || state.saving) return;
  const following = await followingEnabled();
  await showFollowState();
  // Try the page first either way. `activeTab` survives a same-origin move, so
  // walking from one LinkedIn profile to the next often still works without
  // the permission; a profile opened in a new tab does not, and that is where
  // the click used to come from.
  const profile = await readActiveTab();
  if (!profile) {
    if (following) {
      // Chrome refuses its own pages, and LinkedIn is the only other site this
      // panel was given. Neither is a problem to report.
      markIdle("Nothing to read on this page. Open a LinkedIn profile.");
    } else {
      markStale("This is a different page now, and Chrome only lets Retrivr read a page just after you click its toolbar icon. Click the icon, then Read this profile.", { clear: true });
    }
    return;
  }
  const samePerson = Boolean(profile.profileUrl) && profile.profileUrl === state.profileUrl && !state.stale;
  // The heading and the title can both still show the last person while the
  // address already names the next, and then they agree with each other. A new
  // address with the last person's name on it is that moment, not a namesake;
  // a real namesake is one Read this profile away.
  const lastName = state.waiting ? state.leftName : state.filled.name;
  const lagging = profile.isProfile && Boolean(profile.name) && profile.name === lastName &&
    (samePerson ? state.waiting : Boolean(state.profileUrl));
  if (profile.isProfile && (!profile.settled || lagging)) {
    // Nothing from a half-drawn page is trusted except its address. The fields
    // are emptied rather than left describing the last person.
    if (!samePerson) {
      state.leftName = lastName;
      applyProfile({ ...profile, name: "", headline: "", memberId: "" }, { quiet: true });
      el("notes").value = "";
      state.waiting = true;
      say(el("message"), "Reading this profile...", "");
      await checkExisting();
    }
    waitForPage(profile.profileUrl);
    return;
  }
  pageSettled();
  if (samePerson) {
    updateProfile(profile);
    return;
  }
  applyProfile(profile, { quiet: true });
  el("notes").value = "";
  await checkExisting();
}

// A page with nothing on it for us. The fields go with it, because they
// described somebody who is no longer on screen.
function markIdle(message) {
  state.stale = false;
  state.saved = false;
  state.savedRoleId = "";
  state.profileUrl = "";
  state.memberId = "";
  state.filled = { name: "", headline: "" };
  state.waiting = false;
  pageSettled();
  el("open-role").hidden = true;
  el("reread").hidden = true;
  el("save").disabled = false;
  for (const id of ["name", "headline", "profile"]) el(id).value = "";
  resetEmail();
  clearExisting();
  say(el("message"), message, "");
}

// --- have we met? -----------------------------------------------------------
//
// Asked of the workbench, never of LinkedIn: it is this account's own records
// being searched for the link on screen. Knowing now is the difference between
// a considered second look and a duplicate found weeks later.

function clearExisting() {
  state.existingRoleId = "";
  el("existing").hidden = true;
  el("existing").textContent = "";
  el("open-existing").hidden = true;
}

async function checkExisting() {
  clearExisting();
  const link = state.profileUrl;
  if (!link || !state.account) return;
  const { ok, body } = await api(`/api/capture?profileUrl=${encodeURIComponent(link)}`);
  // A lookup that fails is not worth a word: the save itself still refuses a
  // duplicate on the same role.
  if (!ok || state.profileUrl !== link) return;
  readFinder(body.emailFinder);
  // An address this account already keeps for them is shown, not searched for.
  const kept = body.person && typeof body.person.email === "string" ? body.person.email : "";
  if (kept && !el("email").value.trim()) el("email").value = kept;
  state.kept = Boolean(kept);
  showFinder();
  if (!body.existing) return;
  const found = body.existing;
  const role = found.role || {};
  const where = role.client ? `${role.title} (${role.client})` : role.title;
  el("existing").textContent = `Already saved as ${found.fullName} on ${where}${role.status === "closed" ? ", now closed" : ""}. Saving again files them against the role selected below.`;
  el("existing").className = "message";
  el("existing").hidden = false;
  if (role.id) {
    state.existingRoleId = role.id;
    el("open-existing").hidden = false;
  }
}

// --- the email ---------------------------------------------------------------
//
// Find email asks the workbench, which asks Enrow; neither this panel nor the
// workbench asks LinkedIn. One search per click, never on its own, with the
// searches left beside the field. Only a found email spends one.

const FIND_POLL_MS = 2000;
const FIND_GIVE_UP_MS = 62000;

function readFinder(value) {
  state.finder = value && Number.isInteger(value.remaining) && Number.isInteger(value.quota) && value.quota > 0
    ? { remaining: Math.max(0, value.remaining), quota: value.quota, trial: value.trial === true }
    : null;
}

function noteEmail(text, tone) {
  el("email-note").textContent = text;
  el("email-note").className = `note${tone ? ` ${tone}` : ""}`;
}

function showFinder() {
  const finder = state.finder;
  el("find-email").hidden = !finder;
  el("email-left").hidden = !finder;
  if (!finder) return;
  const span = finder.trial ? "in your trial" : "this month";
  el("email-left").textContent = `${finder.remaining} of ${finder.quota} left`;
  el("email-left").title = `${finder.remaining} of ${finder.quota} email searches left ${span}`;
  el("email-left").className = finder.remaining > 0 ? "finder-count" : "finder-count empty";
  // Said on hover, because a button that is merely grey explains nothing.
  const why = finder.remaining <= 0 ? `You have no email searches left ${span}.`
    : !state.profileUrl ? "Open a LinkedIn profile to search for its email."
    : state.kept ? "This person already has an email saved."
    : "";
  el("find-email").disabled = Boolean(why) || state.finding || state.saving;
  el("find-email-wrap").dataset.tip = why;
  el("find-email-wrap").tabIndex = why ? 0 : -1;
}

// A new page is a new person: what was found for the last one goes with them,
// and a search still running for them is no longer listened to.
function resetEmail() {
  state.findRun += 1;
  state.finding = false;
  state.found = "";
  state.kept = false;
  el("email").value = "";
  el("find-email").textContent = "Find email";
  noteEmail("", "");
  showFinder();
}

async function findEmail() {
  if (state.finding || state.saving || !state.finder || !state.profileUrl) return;
  const link = state.profileUrl;
  const run = ++state.findRun;
  const current = () => run === state.findRun && state.profileUrl === link;
  const count = (body) => {
    if (state.finder && Number.isInteger(body.remaining)) state.finder.remaining = Math.max(0, body.remaining);
  };
  state.finding = true;
  el("find-email").textContent = "Searching...";
  noteEmail("", "");
  showFinder();
  try {
    let { ok, status, body } = await api("/api/capture/email", { method: "POST", body: JSON.stringify({ profileUrl: link }) });
    if (!current()) return;
    count(body);
    if (status === 401) {
      await rejectKey(body.error);
      return;
    }
    const id = typeof body.id === "string" ? body.id : "";
    const until = Date.now() + FIND_GIVE_UP_MS;
    while (ok && body.status === "pending" && id && Date.now() < until) {
      await new Promise((done) => setTimeout(done, FIND_POLL_MS));
      if (!current()) return;
      ({ ok, status, body } = await api(`/api/capture/email/${encodeURIComponent(id)}`));
      if (!current()) return;
      count(body);
    }
    if (!ok) {
      noteEmail(`${body.error || `Could not search (${status || "no response"}).`} No credit was used.`, "bad");
    } else if (body.status === "found" && typeof body.email === "string" && body.email) {
      // Filled only over nothing, or over what an earlier search filled.
      if (!el("email").value.trim() || el("email").value === state.found) el("email").value = body.email;
      state.found = body.email;
      state.kept = true;
      noteEmail("Found.", "good");
    } else if (body.status === "not_found") {
      noteEmail("Email cannot be found. No credit was used.", "bad");
    } else if (body.status === "pending") {
      noteEmail("The search is taking too long. Try again in a moment.", "bad");
    } else {
      noteEmail("The search did not finish. No credit was used.", "bad");
    }
  } finally {
    if (run === state.findRun) {
      state.finding = false;
      el("find-email").textContent = "Find email";
      showFinder();
    }
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
// working if the browser refuses the new tab. Once connected, the workbench is
// the one the key works on. The address box belongs to the setup screen, and a
// popup that opens already connected never shows that screen, so the box still
// holds the page's built-in http://localhost:3000: reading it first sent every
// "Open this role" after a save to a server nobody was running.
function openWorkbench(path) {
  const origin = workbenchOrigin(state.account ? state.url : (el("url").value.trim() || state.url));
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
  el("account-plan").textContent = "";
  el("account-plan").hidden = true;
  el("account-origin").textContent = "";
}

function roleStorageKey() {
  return `lastRole:${JSON.stringify([workbenchOrigin(state.url), state.account.id])}`;
}

async function rejectKey(message) {
  state.token = "";
  clearAccount();
  showSetup(`${message || "That key was refused."} Paste the extension key from Settings again.`);
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

  await showFollowState();
  if (!state.profileRead) {
    state.profileRead = true;
    const following = await followingEnabled();
    const profile = await readActiveTab();
    if (!profile) {
      if (following) {
        markIdle("Nothing to read on this page. Open a LinkedIn profile.");
      } else {
        say(el("message"), "Could not read this tab. Type the details in and save.", "bad");
        el("reread").hidden = false;
      }
    } else {
      applyProfile(profile, { quiet: following });
      await checkExisting();
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
    showSetup("The workbench returned an invalid account. Check the address and reconnect with your personal extension key.");
    return;
  }
  state.account = account;
  state.roles = body.roles;
  readFinder(body.emailFinder);
  showFinder();
  showUpdate(body.extension && typeof body.extension.version === "string" ? body.extension.version : "");
  el("account-name").textContent = account.name?.trim() || account.email;
  el("account-email").textContent = account.email;
  // The plan as the workbench names it; an older workbench sends none.
  const plan = typeof account.plan === "string" ? account.plan.trim().slice(0, 40) : "";
  el("account-plan").textContent = plan;
  el("account-plan").hidden = !plan;
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
    say(statusNode(), "Could not open the side panel. This popup still works, and Chrome's own side panel menu can open Retrivr too.", "bad");
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

// Asking is a click of its own, because Chrome only shows the permission
// prompt in answer to a gesture. Refusing it costs nothing: the panel goes on
// working exactly as it did, one toolbar click per profile.
// Turning it on the first time is when Chrome is asked for LinkedIn, inside
// this click. Refusing is a fine answer: the switch goes back off and the
// panel works as it always did, one toolbar click per profile.
el("follow-toggle").addEventListener("change", async () => {
  if (!el("follow-toggle").checked) {
    await remember({ autoRead: false });
    await showFollowState();
    return;
  }
  let granted = await mayFollow();
  if (!granted) {
    try {
      granted = await chrome.permissions.request({ origins: [LINKEDIN_ORIGIN] });
    } catch {
      granted = false;
    }
  }
  if (!granted) {
    await showFollowState();
    say(el("message"), "Not allowed, which is a fine answer. Click Retrivr's icon on each profile and press Read this profile.", "");
    return;
  }
  await remember({ autoRead: true });
  await showFollowState();
  await refreshProfile();
});

el("update-open").addEventListener("click", () => openWorkbench("/account"));

el("open-existing").addEventListener("click", () => {
  if (state.existingRoleId) openWorkbench(`/roles/${encodeURIComponent(state.existingRoleId)}`);
});

el("reread").addEventListener("click", async () => {
  if (state.saving) return;
  say(el("message"), "Reading this page...", "");
  const profile = await readActiveTab();
  if (!profile) {
    markStale("Chrome only lets Retrivr read a page just after you click its toolbar icon. Click the icon, then press Read this profile again.");
    return;
  }
  // Asked for by name, so the page is taken as it is, finished drawing or not.
  pageSettled();
  applyProfile(profile);
  await checkExisting();
});

el("find-email").addEventListener("click", findEmail);

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
    showSetup("Disconnected. Check the address and paste an extension key to connect again.");
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
        email: el("email").value,
        // Kept as found while it is still what Find email found.
        emailFound: Boolean(state.found) && el("email").value.trim().toLowerCase() === state.found.toLowerCase(),
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
      // Saved onto their record if they had none, so there is nothing to find.
      if (el("email").value.trim()) state.kept = true;
      clearExisting();
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
    showFinder();
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
