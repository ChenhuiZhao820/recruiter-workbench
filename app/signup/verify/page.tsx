import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { normalizeEmail, validEmail } from "@/lib/auth-crypto";
import { AuthFrame } from "@/components/AuthFrame";
import { VerifySignupForm } from "@/components/SignupForms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Check your email" };

export default async function VerifySignupPage() {
  if (await getSession()) redirect("/");
  const email = normalizeEmail(cookies().get("capture_signup_email")?.value ?? "");
  if (!validEmail(email)) redirect("/signup");
  return <AuthFrame eyebrow="ONE MORE STEP" title="Check your email" description={<>We sent a six-digit code to <strong>{email}</strong>. It works for 10 minutes.</>}>
    <VerifySignupForm />
    <p className="auth-links">Wrong address? <Link href="/signup">Start again</Link></p>
  </AuthFrame>;
}
