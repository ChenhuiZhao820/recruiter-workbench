import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { signupConfig } from "@/lib/signup-config";
import { publicPage } from "@/lib/seo";
import { LoginForm } from "@/components/AccountForms";
import { AuthFrame } from "@/components/AuthFrame";
import { ProviderButtons } from "@/components/SignupForms";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = publicPage("/login", "Retrivr");

const ERRORS: Record<string, string> = {
  provider: "That Google or Microsoft account is not linked to a Retrivr account. New here? Create an account first.",
  unavailable: "This account is unavailable. Ask your administrator if you think that is wrong.",
};

export default async function LoginPage({ searchParams }: { searchParams: { activated?: string; changed?: string; error?: string } }) {
  if (await getSession()) redirect("/");
  const config = signupConfig();
  const providers = [config.google && "google", config.microsoft && "microsoft"].filter(Boolean) as ("google" | "microsoft")[];
  const error = searchParams.error ? ERRORS[searchParams.error] : undefined;
  return <AuthFrame eyebrow="WELCOME BACK" title="Sign in to Retrivr" description={<>Your workspace is ready.<br />Pick up where the conversation left off.</>}>
    {(searchParams.activated || searchParams.changed) && <p role="status" className="auth-success"><Icon name="check" size={17} />Password saved. Sign in with your new password.</p>}
    {error && <p role="alert" className="mb-4 rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
    <ProviderButtons providers={providers} mode="signin" />
    {providers.length > 0 && <p className="auth-divider"><span>or with your password</span></p>}
    <LoginForm />
    <p className="auth-links"><Link href="/forgot-password">Forgot your password?</Link>{config.open && <> · <Link href="/signup">Create an account</Link></>}</p>
  </AuthFrame>;
}
