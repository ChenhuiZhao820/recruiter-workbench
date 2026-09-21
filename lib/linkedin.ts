// This is the entire extent of the app's relationship with LinkedIn:
// it builds a URL string that is opened in a new tab when the recruiter clicks.
// Do not add fetch calls to this file.

export function peopleSearchUrl(keywords: string): string {
  const q = encodeURIComponent(keywords.trim());
  return `https://www.linkedin.com/search/results/people/?keywords=${q}&origin=FACETED_SEARCH`;
}
