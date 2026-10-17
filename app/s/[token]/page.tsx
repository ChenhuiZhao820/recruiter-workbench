import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { loadClientPage, recordClientView } from "@/lib/shortlists";
import { recordUsage } from "@/lib/usage";
import { ClientLinkInactive, ClientShortlist } from "@/components/ClientShortlist";

export const dynamic = "force-dynamic";

// A client's page, reached from the link in a recruiter's email. No session:
// the signed link is the only key, and it opens this one shortlist and
// nothing else. Not for search engines, and it sends no referrer.
export const metadata: Metadata = {
  title: "Candidates",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ClientShortlistPage({ params }: { params: { token: string } }) {
  const now = new Date();
  const page = await loadClientPage(params.token, now);
  if (page.state !== "active") return <ClientLinkInactive recruiterName={page.recruiterName} />;

  // The recruiter opening their own link is not the client reading it.
  const session = await getSession();
  if (session?.user.id !== page.ownerId && (await recordClientView(page.accessId, now))) {
    await recordUsage(db, page.ownerId, "shortlist_viewed");
  }
  return <ClientShortlist view={page.view} token={params.token} />;
}
