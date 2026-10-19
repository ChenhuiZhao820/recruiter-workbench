import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { MarketingHome } from "@/components/MarketingHome";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Retrivr" };

export default async function WelcomePage() {
  return <MarketingHome signedIn={Boolean(await getSession())} />;
}
