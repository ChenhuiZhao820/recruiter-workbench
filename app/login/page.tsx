import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "@/components/AccountForms";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: { activated?: string; changed?: string } }) {
  if (await getSession()) redirect("/");
  return <div className="mx-auto max-w-md space-y-4">
    <h1 className="text-3xl">Sign in to Basanite</h1>
    <p className="text-ink-soft">Your recruiting work stays in your own workspace.</p>
    {(searchParams.activated || searchParams.changed) && <p role="status" className="rounded border border-accent/30 bg-accent-soft p-3">Password saved. Sign in with your new password.</p>}
    <LoginForm />
  </div>;
}
