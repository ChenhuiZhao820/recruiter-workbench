"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { login, activateAccount, changePassword } from "@/app/actions/auth";
import type { AccountActionState } from "@/app/actions/accounts";
import { CopyButton } from "@/components/CopyButton";
import { Icon } from "@/components/Icon";
import type { FormState } from "@/lib/formState";
import type { RecruiterTier } from "@/lib/account-tiers";

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

function NewPasswordFields() {
  return <>
    <div><label htmlFor="password" className="field-label">New password</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required className="field-input" /></div>
    <div><label htmlFor="confirmation" className="field-label">Confirm new password</label><input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required className="field-input" /></div>
    <p className="text-sm text-ink-soft">Use 12–128 characters. A long, unique passphrase is a good choice.</p>
  </>;
}

export function LoginForm() {
  const [state, action] = useFormState(login, {});
  const [showPassword, setShowPassword] = useState(false);
  return <form action={action} className="auth-form">
    <Status state={state} />
    <div><label htmlFor="email" className="field-label">Email</label><input id="email" name="email" type="email" autoComplete="username" maxLength={254} required className="field-input" placeholder="you@company.com" /></div>
    <div><label htmlFor="password" className="field-label">Password</label><div className="password-field"><input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" maxLength={128} required className="field-input" placeholder="Enter your password" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} aria-controls="password" onClick={() => setShowPassword(!showPassword)}><Icon name="eye" size={18} /></button></div></div>
    <Submit>Sign in<Icon name="arrow" size={17} /></Submit>
  </form>;
}

export function ActivationForm() {
  const [token, setToken] = useState("");
  const router = useRouter();
  useEffect(() => {
    const consumeFragment = () => {
      const nextToken = new URLSearchParams(window.location.hash.slice(1)).get("token");
      if (nextToken) {
        setToken(nextToken);
        router.replace(window.location.pathname, { scroll: false });
      }
    };
    consumeFragment();
    window.addEventListener("hashchange", consumeFragment);
    return () => window.removeEventListener("hashchange", consumeFragment);
  }, [router]);
  return <ActivationPasswordForm key={token} token={token} />;
}

function ActivationPasswordForm({ token }: { token: string }) {
  const [state, action] = useFormState(activateAccount, {});
  return <form action={action} className="card space-y-4">
    <Status state={state} />
    <input name="token" type="hidden" value={token} />
    {token ? <><NewPasswordFields /><Submit>Set password</Submit></> : <p role="alert">Open the complete link from your email or your administrator. If you refreshed this page, reopen that link.</p>}
    <p className="text-sm text-ink-soft">Setting a password signs out existing sessions and revokes extension keys. Reconnect your extension after signing in.</p>
  </form>;
}

export function PasswordForm() {
  const [state, action] = useFormState(changePassword, {});
  return <form action={action} className="card space-y-4">
    <Status state={state} />
    <div><label htmlFor="currentPassword" className="field-label">Current password</label><input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required className="field-input" /></div>
    <NewPasswordFields />
    <p className="text-sm text-ink-soft">Changing your password signs out all sessions and revokes your extension key.</p>
    <Submit>Change password</Submit>
  </form>;
}

export function AccountTierFields({ id, initialTier = "basic", trialExpiresAt = null }: {
  id: string;
  initialTier?: RecruiterTier;
  trialExpiresAt?: string | null;
}) {
  const [tier, setTier] = useState(initialTier);
  return <>
    <div>
      <label htmlFor={`${id}-tier`} className="field-label">Account type</label>
      <select id={`${id}-tier`} name="accountTier" value={tier} onChange={(event) => setTier(event.target.value as typeof tier)} className="field-input">
        <option value="lite">Lite</option><option value="basic">Basic</option><option value="pro">Pro</option><option value="promax">Pro Max</option><option value="trial">Trial</option>
      </select>
    </div>
    {tier === "trial" && <div>
      <label htmlFor={`${id}-expiry`} className="field-label">Trial expires at (UTC)</label>
      <input id={`${id}-expiry`} name="trialExpiresAt" type="datetime-local" step={60} defaultValue={trialExpiresAt?.slice(0, 16) ?? ""} required aria-describedby={`${id}-expiry-help`} className="field-input" />
      <p id={`${id}-expiry-help`} className="mt-2 section-caption">Use UTC, not local time. Trial includes Pro access until this time, then automatically returns to Basic. Accounts that signed themselves up have no plan after a trial unless they subscribe.</p>
    </div>}
  </>;
}

export function AccountManagementForm({ action, children, submitLabel }: {
  action: (state: AccountActionState, form: FormData) => Promise<AccountActionState>;
  children?: React.ReactNode;
  submitLabel: string;
}) {
  const [state, formAction] = useFormState(action, {} as AccountActionState);
  return <form action={formAction} className="space-y-3">
    <Status state={state} />
    {state.activationUrl && <div className="space-y-2">
      <input aria-label="One-time setup link" className="field-input" value={state.activationUrl} readOnly autoComplete="off" />
      <CopyButton text={state.activationUrl} label="Copy setup link" />
    </div>}
    {children}
    <div className="flex flex-wrap items-center gap-3">
      <Submit>{submitLabel}</Submit>
      {state.accountUrl && <Link href={state.accountUrl} className="btn-secondary">Manage account</Link>}
    </div>
  </form>;
}

export function DeleteAccountForm({ userId, email, action }: { userId: string; email: string; action: (state: FormState, form: FormData) => Promise<FormState> }) {
  const [state, formAction] = useFormState(action, {});
  return <details className="border-t border-line pt-4">
    <summary className="cursor-pointer text-sm text-rose-900">Delete account</summary>
    <form action={formAction} className="mt-3 max-w-xl space-y-3">
      <Status state={state} />
      <p className="text-sm text-ink-soft">This permanently deletes the account and all of its roles, candidates, people, notes, searches, templates, bookings and settings. It cannot be undone. A paid subscription is cancelled with it. The audit history is kept.</p>
      <input type="hidden" name="userId" value={userId} />
      <div><label htmlFor={`confirm-delete-${userId}`} className="field-label">Type {email} to confirm</label><input id={`confirm-delete-${userId}`} name="confirmEmail" autoComplete="off" required className="field-input" /></div>
      <DeleteSubmit />
    </form>
  </details>;
}

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn-secondary border-rose-300 text-rose-900" disabled={pending}>{pending ? "Deleting…" : "Delete account permanently"}</button>;
}
