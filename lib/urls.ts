// Profile links are pasted by hand, so they arrive in whatever shape LinkedIn
// happened to show them: with a scheme, without one, or occasionally as
// something that is not a link at all.
//
// normalizeProfileUrl runs on the way in and adds the missing scheme.
// profileHref runs on the way out and refuses to render anything that is not
// an absolute http(s) URL, so a stored oddity can never become a dead link
// pointing back into this app.

export { normalizeProfileUrl } from "./person-keys.mjs";

export function profileHref(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // Also keeps javascript: and data: out of an href we render.
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
