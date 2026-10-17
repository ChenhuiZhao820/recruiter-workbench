import { redirect } from "next/navigation";
import { requireFeature } from "@/lib/feature-access";

export const dynamic = "force-dynamic";

// Instant Match lives on the People page now. Links already sent or saved
// (a match, a role to start from) open there with the same address state.
export default async function InstantMatchRedirect({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireFeature("instantMatch");
  const params = new URLSearchParams();
  for (const key of ["c", "x", "role", "all"]) {
    const value = searchParams[key];
    if (typeof value === "string" && value) params.set(key, value);
  }
  redirect(params.size ? `/people?${params.toString()}` : "/people");
}
