// The releases themselves, as plain data, so a unit test can hold them against
// the extension's manifest. What they mean and how they are read is in
// lib/release.ts.
//
// An id is the day it shipped, newest first, with ".2", ".3" for a second
// release the same day. `extension` is the extension version that release
// needs, or null when the copy already installed is fine, and the newest one
// also carries the `fingerprint` of the download it asks for. Any change to
// what /api/extension/download hands out changes that fingerprint, and the
// build then refuses to run until a release here announces it
// (lib/extension-release.mjs; `node scripts/check-extension-release.mjs
// --fingerprint` prints the value). Never edit a shipped release's
// fingerprint or version: whoever read it would not be told again.

/** @type {readonly { id: string; title: string; extension: string | null; fingerprint?: string }[]} */
export const RELEASES = [
  { id: "2026-10-21", title: "Email a candidate from the same click as your LinkedIn message", extension: null },
  { id: "2026-10-19.3", title: "Retrivr has moved to retrivr.app: sign in there and load the new extension", extension: "1.2.3", fingerprint: "e30adacbd886e6fe" },
  { id: "2026-10-19.2", title: "Opening a role from the extension after saving goes to Retrivr, not to localhost", extension: "1.2.2", fingerprint: "1cdb0cec69150bbe" },
  { id: "2026-10-19", title: "The extension panel keeps up as you move from one LinkedIn profile to the next", extension: "1.2.1" },
  { id: "2026-10-18", title: "Clients see who you put forward, say who they want to meet, and those people book the interview", extension: null },
  { id: "2026-10-03", title: "One person across every role, booking links, screening summaries and matches from your own database", extension: null },
  { id: "2026-09-24", title: "LinkedIn's own industries, an outreach queue and an extension panel that follows you", extension: "1.2.0" },
];

// The day a release shipped, whatever its same-day suffix.
export function releaseDay(id) {
  return id.slice(0, 10);
}
