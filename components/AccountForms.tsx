"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { login, activateAccount, changePassword } from "@/app/actions/auth";
import type { AccountActionState } from "@/app/actions/accounts";
import { issueExtensionCode, redeemExtensionCode, type ExtensionActionState } from "@/app/actions/extension";
import { CopyButton } from "@/components/CopyButton";
import { Icon } from "@/components/Icon";
import type { FormState } from "@/lib/formState";

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
    <p className="auth-help">Need an account or a password reset? Ask your administrator for a one-time setup link.</p>
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
    {token ? <><NewPasswordFields /><Submit>Set password</Submit></> : <p role="alert">Open the complete setup link provided by your administrator. If you refreshed this page, reopen that link.</p>}
    <p className="text-sm text-ink-soft">Setting a password signs out existing sessions and revokes capture keys. Reconnect your extension after signing in.</p>
  </form>;
}

export function PasswordForm() {
  const [state, action] = useFormState(changePassword, {});
  return <form action={action} className="card space-y-4">
    <Status state={state} />
    <div><label htmlFor="currentPassword" className="field-label">Current password</label><input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required className="field-input" /></div>
    <NewPasswordFields />
    <p className="text-sm text-ink-soft">Changing your password signs out all sessions and revokes your extension capture key.</p>
    <Submit>Change password</Submit>
  </form>;
}

export function ExtensionCodeForm({ userId, issued }: { userId: string; issued: boolean }) {
  const [state, action] = useFormState(issueExtensionCode, {} as ExtensionActionState);
  return <form action={action} className="space-y-3">
    <Status state={state} />
    <input type="hidden" name="userId" value={userId} />
    {state.code && <div className="space-y-2">
      <input aria-label="New extension activation code" value={state.code} readOnly autoComplete="off" className="field-input font-mono" />
      <CopyButton text={state.code} label="Copy extension code" />
      <p className="section-caption">Shown only now. Share privately with this account holder, not in a URL. A replacement immediately invalidates the previous code.</p>
    </div>}
    <Submit>{issued ? "Replace extension code" : "Generate extension code"}</Submit>
  </form>;
}

export function ExtensionActivationForm() {
  const [state, action] = useFormState(redeemExtensionCode, {} as ExtensionActionState);
  return <form action={action} className="max-w-xl space-y-4">
    <Status state={state} />
    <div>
      <label htmlFor="extension-code" className="field-label">Extension activation code</label>
      <input id="extension-code" name="code" type="password" autoComplete="off" spellCheck={false} maxLength={128} required className="field-input font-mono" />
    </div>
    <Submit>Activate extension</Submit>
  </form>;
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
    <Submit>{submitLabel}</Submit>
  </form>;
}
