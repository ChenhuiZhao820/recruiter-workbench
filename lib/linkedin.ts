// This is the entire extent of the app's relationship with LinkedIn:
// it builds or checks a URL string that is opened in a new tab when the
// recruiter clicks. Do not add fetch calls to this file.

// Ordinary people search keeps its filters in the address, as facet lists of
// LinkedIn's own ids: industry=["4","41"]. So the industries picked in Capture
// can be applied before the tab opens, with nothing to re-tick.
export function peopleSearchUrl(keywords: string, industryIds: string[] = []): string {
  const params = new URLSearchParams();
  params.set("keywords", keywords.trim());
  if (industryIds.length > 0) params.set("industry", JSON.stringify(industryIds));
  params.set("origin", "FACETED_SEARCH");
  return `https://www.linkedin.com/search/results/people/?${params.toString()}`;
}

// --- a search LinkedIn already knows about ----------------------------------
//
// Recruiter is the exception: its address carries only opaque ids
// (searchContextId, searchHistoryId, searchRequestId) and keeps the filters
// server side, so no one outside can write industries into it. What LinkedIn
// will do is give a saved search back, at an address of its choosing. The
// recruiter builds the filters once, in Recruiter, saves the search there, and
// pastes the address here. Opening it restores everything LinkedIn stored.
//
// The address is therefore opaque on purpose. This app does not read its
// parameters, keep them in step with a filter list of its own, or rebuild them
// when LinkedIn changes them. It checks that the address is a LinkedIn search
// and opens it.

// Recruiter lives under /talent, ordinary search under /search. Country and
// language subdomains are real (uk.linkedin.com), so the host rule is the
// registrable domain rather than one spelling of it.
const SEARCH_PATHS = ["/talent/", "/search/"];

export function isLinkedInHost(hostname: string): boolean {
  return /^(?:[a-z0-9-]+\.)*linkedin\.com$/.test(hostname.toLowerCase());
}

// The address to store, or "" when it is not one this app will open. Anything
// rejected here is reported to the recruiter rather than silently dropped.
export function searchLinkUrl(value: string): string {
  const text = value.trim();
  if (!text) return "";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || url.username || url.password) return "";
  if (!isLinkedInHost(url.hostname)) return "";
  // A bare /talent or /search is the product's front door, not a search, and
  // opening it would look like the filters were lost rather than never saved.
  if (!SEARCH_PATHS.some((path) => url.pathname.startsWith(path))) return "";
  return url.toString();
}

// Why a pasted address was refused, in the recruiter's terms.
export function searchLinkProblem(value: string): string | null {
  if (!value.trim() || searchLinkUrl(value)) return null;
  return "That is not a LinkedIn search address. Run the search in LinkedIn or Recruiter, copy the address from the browser bar, and paste it here. It must start with https:// and be a linkedin.com/talent/... or linkedin.com/search/... address.";
}

// --- opening the message box ------------------------------------------------
//
// A profile link opens the profile, where the recruiter still has to find the
// Message button. LinkedIn's compose address opens the message box itself, but
// it is keyed by LinkedIn's own member id rather than by the vanity name in the
// profile link, so it is only available for candidates the extension saved.
//
// Still just an address opened on a click. It carries a recipient and nothing
// else: LinkedIn has no parameter for the message body, and this app does not
// type into anyone else's page.
const MEMBER_ID = /^[A-Za-z0-9_-]{5,60}$/;

// The id as LinkedIn writes it, or null. Used on the way in as well as out, so
// a value that could never open a message box is never stored in the first place.
export function memberIdOrNull(value: string | null | undefined): string | null {
  const id = (value ?? "").trim();
  return MEMBER_ID.test(id) ? id : null;
}

export function messageComposeUrl(memberId: string | null | undefined): string {
  const id = (memberId ?? "").trim();
  if (!MEMBER_ID.test(id)) return "";
  return `https://www.linkedin.com/messaging/compose/?recipient=${encodeURIComponent(id)}`;
}
