import { redirect } from "next/navigation";

// Activity became Notifications; an address saved or bookmarked before still
// lands on it.
export default function ActivityPage() {
  redirect("/notifications");
}
