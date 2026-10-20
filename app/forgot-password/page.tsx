import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AuthFrame } from "@/components/AuthFrame";
import { ForgotPasswordForm } from "@/components/SignupForms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reset your Retrivr password" };

export default async function ForgotPasswordPage() {
  if (await getSession()) redirect("/");
  return <AuthFrame eyebrow="FORGOT YOUR PASSWORD" title="Set a new password" description="We will email you a link that works once, for an hour.">
    <ForgotPasswordForm />
    <p className="auth-links"><Link href="/login">Back to sign in</Link></p>
  </AuthFrame>;
}
