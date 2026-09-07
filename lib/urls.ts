// Profile links are pasted by hand, so they arrive in whatever shape LinkedIn
// happened to show them: with a scheme, without one, or occasionally as
// something that is not a link at all.
//
// normalizeProfileUrl runs on the way in and adds the missing scheme.
// profileHref runs on the way out and refuses to render anything that is not
// an absolute http(s) URL, so a stored oddity can never become a dead link
// pointing back into this app.

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const LOOKS_LIKE_HOST = /^[\w-]+(\.[\w-]+)+([/?#]|$)/;

export function normalizeProfileUrl(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (HAS_SCHEME.test(raw)) return raw;
  if (LOOKS_LIKE_HOST.test(raw)) return `https://${raw}`;
  // Not a link. Keep what the recruiter typed rather than discarding it;
  // profileHref will decline to link it.
  return raw;
}

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
