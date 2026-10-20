"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { acceptTermsForProvider, resendSignupCode, startSignup, verifySignup } from "@/app/actions/signup";
import { requestPasswordReset } from "@/app/actions/auth";
import { Icon } from "@/components/Icon";
import type { FormState } from "@/lib/formState";

type Provider = "google" | "microsoft";
const PROVIDER_LABEL: Record<Provider, string> = { google: "Google", microsoft: "Microsoft" };

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Please wait…" : children}</button>;
}

function Status({ state }: { state: FormState }) {
  return <>
    {state.error && <p role="alert" className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{state.error}</p>}
    {state.notice && <p role="status" className="rounded border border-accent/30 bg-accent-soft p-3 text-sm">{state.notice}</p>}
  </>;
}

// Starts Better Auth's provider round trip from this page. For a sign-up the
// terms are agreed first (a signed cookie the account creation looks for).
async function startProvider(provider: Provider, mode: "signup" | "signin"): Promise<string | null> {
  const response = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      callbackURL: "/",
      newUserCallbackURL: "/getting-started",
      errorCallbackURL: mode === "signup" ? "/signup?error=provider" : "/login?error=provider",
    }),
  }).catch(() => null);
  const data = response?.ok ? await response.json().catch(() => null) as { url?: unknown } | null : null;
  if (typeof data?.url !== "string") return `${PROVIDER_LABEL[provider]} sign-in could not start. Reload the page and try again.`;
  window.location.assign(data.url);
  return null;
}

export function ProviderButtons({ providers, mode, termsAccepted = true }: { providers: Provider[]; mode: "signup" | "signin"; termsAccepted?: boolean }) {
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!providers.length) return null;
  async function go(provider: Provider) {
    setError(null);
    setBusy(provider);
    if (mode === "signup") {
      const accepted = await acceptTermsForProvider(termsAccepted);
      if (accepted.error) {
        setError(accepted.error);
        setBusy(null);
        return;
      }
    }
    const failed = await startProvider(provider, mode);
    if (failed) {
      setError(failed);
      setBusy(null);
    }
  }
  return <div className="provider-buttons">
    {error && <p role="alert" className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
    {providers.map((provider) => <button key={provider} type="button" className="btn-secondary" disabled={busy !== null} onClick={() => go(provider)}>
      {busy === provider ? "Opening…" : `${mode === "signup" ? "Sign up" : "Sign in"} with ${PROVIDER_LABEL[provider]}`}
    </button>)}
  </div>;
}

export function SignupPanel({ email, providers, termsUrl, privacyUrl }: { email: boolean; providers: Provider[]; termsUrl: string; privacyUrl: string }) {
  const [state, action] = useFormState(startSignup, {} as FormState);
  const [accepted, setAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // The terms box sits above the provider buttons, outside the email form, so
  // it joins that form through `form=` and is posted with it even before the
  // page's script has loaded.
  return <div className="auth-form">
    <label className="signup-terms">
      <input type="checkbox" name="terms" form="signup-email-form" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
      <span>I agree to the <a href={termsUrl} target="_blank" rel="noreferrer" className="text-accent underline">terms</a> and the <a href={privacyUrl} target="_blank" rel="noreferrer" className="text-accent underline">privacy policy</a>, including that Retrivr processes the candidate details I keep in it on my behalf.</span>
    </label>
    <ProviderButtons providers={providers} mode="signup" termsAccepted={accepted} />
    {email && providers.length > 0 && <p className="auth-divider"><span>or with your email</span></p>}
    {email && <form id="signup-email-form" action={action} className="auth-form">
      <Status state={state} />
      <div><label htmlFor="signup-name" className="field-label">Your name</label><input id="signup-name" name="name" autoComplete="name" maxLength={120} required className="field-input" /></div>
      <div><label htmlFor="signup-email" className="field-label">Work email</label><input id="signup-email" name="email" type="email" autoComplete="email" maxLength={254} required className="field-input" placeholder="you@company.com" /></div>
      <div><label htmlFor="signup-password" className="field-label">Password</label><div className="password-field"><input id="signup-password" name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={128} required className="field-input" placeholder="12 characters or more" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} aria-controls="signup-password" onClick={() => setShowPassword(!showPassword)}><Icon name="eye" size={18} /></button></div></div>
      <Submit>Email me a code<Icon name="arrow" size={17} /></Submit>
    </form>}
    <p className="auth-help">Seven days of Pro, no card. When it ends, choose a plan to keep working; nothing you saved is lost either way.</p>
  </div>;
}

export function VerifySignupForm() {
  const [state, action] = useFormState(verifySignup, {} as FormState);
  const [resent, resend] = useFormState(resendSignupCode, {} as FormState);
  return <div className="auth-form">
    <form action={action} className="auth-form">
      <Status state={state} />
      <div><label htmlFor="signup-code" className="field-label">Six-digit code</label><input id="signup-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className="field-input font-mono tracking-[0.3em]" /></div>
      <Submit>Create my account<Icon name="arrow" size={17} /></Submit>
    </form>
    <form action={resend}>
      <Status state={resent} />
      <button type="submit" className="btn-quiet">Send a new code</button>
    </form>
  </div>;
}

export function ForgotPasswordForm() {
  const [state, action] = useFormState(requestPasswordReset, {} as FormState);
  return <form action={action} className="auth-form">
    <Status state={state} />
    <div><label htmlFor="reset-email" className="field-label">Email</label><input id="reset-email" name="email" type="email" autoComplete="username" maxLength={254} required className="field-input" placeholder="you@company.com" /></div>
    <Submit>Email me a link<Icon name="arrow" size={17} /></Submit>
  </form>;
}
