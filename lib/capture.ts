import { randomBytes, timingSafeEqual } from "node:crypto";

// The capture endpoint is the one door into this app that is not a form the
// recruiter is looking at, so it is guarded by a secret they generate and
// paste into the extension. An empty token means capture is off entirely.

export function newCaptureToken(): string {
  return randomBytes(24).toString("base64url");
}

export function tokenMatches(expected: string, presented: string | null): boolean {
  if (!expected || !presented) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  // timingSafeEqual throws on length mismatch, which is itself a leak, so
  // compare lengths first and keep the comparison constant-time after that.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Only the extension is allowed to call this endpoint from a browser. Echoing
// the origin back for chrome-extension:// (and the Firefox equivalent) means a
// random web page Paul visits cannot read the response even if it guessed the
// token.
export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && /^(chrome-extension|moz-extension|safari-web-extension):\/\//.test(origin)
      ? origin
      : "";
  return {
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Capture-Token",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}
