import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extensionFiles } from "./extension-package.mjs";
import { RELEASES } from "./releases.mjs";

// Chrome never updates an extension loaded by hand, so a change to what
// /api/extension/download hands out reaches nobody unless a release tells them
// to fetch it. This is what makes forgetting impossible: the newest release
// with an extension names the version and the fingerprint of the download it
// asked people for, and the build refuses to go on when the download no
// longer matches (scripts/check-extension-release.mjs, run by both builds).

export const EXTENSION_SOURCE_FILES = ["manifest.json", "popup.html", "popup.css", "popup.js"];

// Packaged for a fixed stand-in origin, so the fingerprint is the same on every
// machine and for every deployment, and still covers what the packager adds.
const FINGERPRINT_ORIGIN = "https://workbench.example";

export async function readExtensionSource(root = process.cwd()) {
  return Object.fromEntries(await Promise.all(EXTENSION_SOURCE_FILES.map(async (name) => [
    name, await readFile(path.join(root, "extension", name), "utf8"),
  ])));
}

// A checkout on Windows and the build on Linux must agree, so line endings are
// not part of it.
export function extensionFingerprint(source) {
  const normalised = Object.fromEntries(Object.entries(source).map(([name, text]) => [name, text.replace(/\r\n?/g, "\n")]));
  const files = extensionFiles(normalised, FINGERPRINT_ORIGIN);
  const hash = createHash("sha256");
  for (const name of Object.keys(files).sort()) hash.update(`${name}\0${files[name]}\0`);
  return hash.digest("hex").slice(0, 16);
}

// Everything wrong with the release list against this download, as sentences
// that say what to do. Empty means the people who need a new copy are told.
export function extensionReleaseProblems(source, releases = RELEASES) {
  const { version } = JSON.parse(source["manifest.json"]);
  const fingerprint = extensionFingerprint(source);
  const announced = releases.filter((release) => release.extension);
  const newest = announced[0];
  const todo = `bump "version" in extension/manifest.json, add a release to the front of lib/releases.mjs with extension: "<that version>" and fingerprint: "${fingerprint}", and rewrite app/whats-new/page.tsx for it`;
  const problems = [];
  if (!newest) return [`No release asks for the extension. To announce this copy, ${todo}.`];
  if (new Set(announced.map((release) => release.extension)).size !== announced.length) {
    problems.push("Two releases in lib/releases.mjs ask for the same extension version. Each new copy needs its own version.");
  }
  if (newest.extension !== version) {
    problems.push(`extension/manifest.json is ${version}, but the newest release that asks for the extension (${newest.id}) asks for ${newest.extension}. Add a release for ${version} to the front of lib/releases.mjs with extension: "${version}" and fingerprint: "${fingerprint}".`);
  } else if (newest.fingerprint !== fingerprint) {
    problems.push(`The extension download has changed since release ${newest.id} (${newest.extension}) asked for it, and nobody would be told to fetch it. To ship it, ${todo}. Never change the fingerprint of a release that has shipped: the people who read it would not be told again.`);
  }
  return problems;
}
