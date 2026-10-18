import type { Metadata } from "next";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { GATE_COOKIE, loadClientPage, recordClientView } from "@/lib/shortlists";
import { recordUsage } from "@/lib/usage";
import { ClientLinkGate, ClientLinkInactive, ClientShortlist } from "@/components/ClientShortlist";

export const dynamic = "force-dynamic";

// A client's page, reached from the link in a recruiter's email. No session:
// the signed link is the only key, and it opens this one shortlist and
// nothing else. Not for search engines, and it sends no referrer to any
// other site.
export const metadata: Metadata = {
  title: "Candidates",
  robots: { index: false, follow: false },
  // same-origin, not no-referrer, like the booking page: under no-referrer
  // Chrome posts the client's answer with `Origin: null`, which Next cannot
  // parse. Other sites still get no referrer.
  referrer: "same-origin",
};

export default async function ClientShortlistPage({ params }: { params: { token: string } }) {
  const now = new Date();
  const page = await loadClientPage(params.token, now, cookies().get(GATE_COOKIE)?.value);
  if (page.state === "inactive") return <ClientLinkInactive recruiterName={page.recruiterName} />;
  // A link sent to a named person opens once this browser confirms the email.
  if (page.state === "gate") return <ClientLinkGate token={params.token} recruiterName={page.recruiterName} />;

  // The recruiter opening their own link is not the client reading it.
  const session = await getSession();
  if (session?.user.id !== page.ownerId && (await recordClientView(page.accessId, now))) {
    await recordUsage(db, page.ownerId, "shortlist_viewed");
  }
  return <ClientShortlist view={page.view} token={params.token} />;
}
