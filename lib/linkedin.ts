// This is the entire extent of the app's relationship with LinkedIn:
// it builds or checks a URL string that is opened in a new tab when the
// recruiter clicks. Do not add fetch calls to this file.

export function peopleSearchUrl(keywords: string): string {
  const q = encodeURIComponent(keywords.trim());
  return `https://www.linkedin.com/search/results/people/?keywords=${q}&origin=FACETED_SEARCH`;
}

// --- a search LinkedIn already knows about ----------------------------------
//
// Industries, and most of Recruiter's filters, cannot be put into an address
// from out here: LinkedIn keeps them behind a search of its own. What it will
// do is give that search back, at an address of its choosing. So the recruiter
// builds the filters once, in LinkedIn, saves the search there, and pastes the
// address here. Opening it restores everything LinkedIn stored, with nothing
// to re-tick and nothing for this app to translate.
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
