import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { signupConfig } from "@/lib/signup-config";
import { publicPage } from "@/lib/seo";
import { AuthFrame } from "@/components/AuthFrame";
import { SignupPanel } from "@/components/SignupForms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = publicPage("/signup", "Create your Retrivr account");

export default async function SignupPage({ searchParams }: { searchParams: { error?: string } }) {
  if (await getSession()) redirect("/");
  const config = signupConfig();
  if (!config.open) {
    return <AuthFrame eyebrow="CREATE AN ACCOUNT" title="Sign-up opens soon" description="Accounts are still set up by hand while we finish opening sign-up.">
      <p className="auth-help">Write to us from the <Link href="/#contact" className="text-accent underline">homepage</Link> and we will set one up for you. Already have one? <Link href="/login" className="text-accent underline">Sign in</Link>.</p>
    </AuthFrame>;
  }
  const providers = [config.google && "google", config.microsoft && "microsoft"].filter(Boolean) as ("google" | "microsoft")[];
  return <AuthFrame eyebrow="START FREE" title="Create your Retrivr account" description={<span className="signup-offer">7 days of Pro, no card needed.</span>}>
    {searchParams.error === "provider" && <p role="alert" className="mb-4 rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">That account could not be used to sign up. Google or Microsoft has to confirm the email address, and the terms box has to be ticked first. Signing up with your email works too.</p>}
    <SignupPanel email={config.email} providers={providers} termsUrl={config.termsUrl} privacyUrl={config.privacyUrl} />
    <p className="auth-links">Already have an account? <Link href="/login">Sign in</Link></p>
  </AuthFrame>;
}
