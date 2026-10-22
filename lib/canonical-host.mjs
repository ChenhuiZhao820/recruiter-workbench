// The site answers at one address, APP_ORIGIN. It used to be another, and
// links already sent - a candidate's booking link, a client's shortlist - still
// name the old one. Those keep working by being sent to the same path here:
// their signatures cover the token, never the host. A page served at the old
// address would not work anyway, because every form posts back to it and the
// same-origin check names APP_ORIGIN.
//
// Only page routes come through here (middleware.ts does not match /api), so
// an extension packaged for the old address keeps saving until its recruiter
// loads the new copy: it refuses redirects, and its extension key is the same.
//
// Development and the test server run on loopback HTTP and are never
// redirected, so reaching one by 127.0.0.1 or localhost alike still works.
export function canonicalRedirect(appOrigin, requestHost, pathname, search) {
  let canonical;
  try {
    canonical = new URL(appOrigin);
  } catch {
    return null;
  }
  if (canonical.protocol !== "https:" || !requestHost) return null;
  const host = requestHost.split(",")[0].trim().toLowerCase();
  if (!host || host === canonical.host) return null;
  // Concatenated, not resolved: a path such as //elsewhere.example must stay a
  // path on this site rather than become another host.
  return `${canonical.origin}${pathname.startsWith("/") ? pathname : `/${pathname}`}${search || ""}`;
}
