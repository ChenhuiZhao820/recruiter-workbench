import type { MetadataRoute } from "next";
import { appOrigin } from "@/lib/auth";
import { LEGAL_VERSION } from "@/lib/legal";

// Read at request time, so the addresses name the APP_ORIGIN the service runs
// with rather than whatever the build happened to see.
export const dynamic = "force-dynamic";

// The day the homepage, sign-in or sign-up last changed in a way worth a
// search engine's second look. Change it with them: Google Search Console and
// Bing re-crawl by lastmod, and a date that moves on every request is ignored.
const PAGES_UPDATED = "2026-10-21";

// Only what anyone may read. /welcome is the homepage again, and booking and
// client pages are signed, private and noindex; everything else needs a session.
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = appOrigin();
  return [
    { url: `${origin}/`, lastModified: PAGES_UPDATED, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/signup`, lastModified: PAGES_UPDATED, changeFrequency: "monthly", priority: 0.8 },
    { url: `${origin}/login`, lastModified: PAGES_UPDATED, changeFrequency: "yearly", priority: 0.3 },
    { url: `${origin}/terms`, lastModified: LEGAL_VERSION, changeFrequency: "yearly", priority: 0.2 },
    { url: `${origin}/privacy`, lastModified: LEGAL_VERSION, changeFrequency: "yearly", priority: 0.2 },
  ];
}
