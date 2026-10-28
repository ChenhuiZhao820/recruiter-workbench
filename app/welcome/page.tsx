import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { MarketingHome } from "@/components/MarketingHome";
import { signupConfig } from "@/lib/signup-config";
import { publicPage } from "@/lib/seo";

export const dynamic = "force-dynamic";

// The homepage again, so search engines are pointed at / rather than told
// there are two.
export const metadata: Metadata = publicPage("/", "Retrivr");

export default async function WelcomePage() {
  return <MarketingHome signedIn={Boolean(await getSession())} signupOpen={signupConfig().open} />;
}
