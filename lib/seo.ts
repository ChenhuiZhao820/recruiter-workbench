import type { Metadata } from "next";
import { tiers } from "@/lib/plan-prices";

// What search engines and link previews read about the public pages. Only
// the pages anyone may read use publicPage: booking and client links are
// private, and a workspace page is never crawled, so neither gets a card.
// Relative addresses resolve against metadataBase, which the root layout sets
// from APP_ORIGIN.
export const SITE_DESCRIPTION = "A focused workspace for your recruiting pipeline. Keep roles, candidate context and thoughtful follow-ups together — with you in control.";

// public/brand/og-card.png: the homepage's heading on its grid, 1200 x 630.
const CARD = { url: "/brand/og-card.png", width: 1200, height: 630, alt: "Retrivr: good recruiting, without the busywork." };

export function publicPage(path: string, title: string, description = SITE_DESCRIPTION): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: "Retrivr", locale: "en_GB", url: path, title, description, images: [CARD] },
    twitter: { card: "summary_large_image", title, description, images: [CARD] },
  };
}

// The homepage's JSON-LD: who publishes the site and what the product is.
// Prices come from the homepage's own table. Nothing here may claim more than
// the page does - no ratings, reviews or customer counts.
export function homeStructuredData(origin: string): string {
  const prices = tiers.map((tier) => tier.monthly);
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${origin}/#organization`, name: "Retrivr", url: `${origin}/`, logo: `${origin}/brand/retrivr-mark.png` },
      { "@type": "WebSite", "@id": `${origin}/#website`, name: "Retrivr", url: `${origin}/`, inLanguage: "en-GB", publisher: { "@id": `${origin}/#organization` } },
      {
        "@type": "SoftwareApplication", name: "Retrivr", url: `${origin}/`, description: SITE_DESCRIPTION,
        applicationCategory: "BusinessApplication", operatingSystem: "Web",
        publisher: { "@id": `${origin}/#organization` },
        offers: { "@type": "AggregateOffer", priceCurrency: "GBP", lowPrice: Math.min(...prices), highPrice: Math.max(...prices), offerCount: tiers.length },
      },
    ],
  };
  // Inside a <script>, "</script>" in a string would end it early.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
