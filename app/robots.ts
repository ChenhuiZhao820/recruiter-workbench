import type { MetadataRoute } from "next";
import { appOrigin } from "@/lib/auth";

// Read at request time, like the sitemap, so it names the APP_ORIGIN the
// service runs with.
export const dynamic = "force-dynamic";

// The search crawlers named on purpose, so a later change to "*" cannot shut
// them out by accident: ChatGPT and Claude search, Perplexity, Google, Bing.
// A crawler that matches a named group ignores "*", so each group carries the
// whole rule.
const SEARCH_BOTS = ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot", "Googlebot", "Bingbot"];

// Training crawlers (GPTBot, ClaudeBot, Google-Extended) are deliberately
// left under "*": all they can reach is the public homepage, sign-in and the
// legal pages, and being known to models helps Retrivr get named.
//
// /api/ holds no pages. Booking and client links (/book, /s) are not listed:
// they are noindex, and a crawler has to be allowed to fetch one to see that -
// a disallowed address can still be indexed bare from a link elsewhere.
// Everything else needs a session and sends a crawler to /login.
export default function robots(): MetadataRoute.Robots {
  const rule = { allow: "/", disallow: "/api/" };
  return {
    rules: [
      { userAgent: SEARCH_BOTS, ...rule },
      { userAgent: "*", ...rule },
    ],
    sitemap: `${appOrigin()}/sitemap.xml`,
  };
}
