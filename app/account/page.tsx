import Link from "next/link";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { canUseExtension } from "@/lib/extension-access";
import { DeleteAccountForm, PasswordForm } from "@/components/AccountForms";
import { Icon } from "@/components/Icon";
import { accountTierLabels, getAccountTier } from "@/lib/account-tiers";
import { formatWhen } from "@/lib/dates";
import { deleteOwnAccount } from "@/app/actions/accounts";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const { user, readOnly, noPlan } = await getWorkspace();
  const viewing = readOnly && !noPlan;
  const extensionEnabled = canUseExtension(user);
  const tier = getAccountTier(user);
  const signIn = await db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true, authAccounts: { select: { providerId: true } } } });
  const providers = Array.from(new Set(signIn?.authAccounts.map((account) => account.providerId === "google" ? "Google" : account.providerId === "microsoft" ? "Microsoft" : null).filter(Boolean)));
  return <div className="max-w-4xl space-y-8">
    <header className="page-header">
      <div>
        <p className="page-eyebrow">Workspace / Account</p>
        <h1>Your account</h1>
        <p className="page-description">Your identity and sign-in security, in one place.</p>
      </div>
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-accent"><Icon name="shield" size={22} /></span>
    </header>
    <div className="grid items-start gap-6 md:grid-cols-[1fr_1.5fr]">
      <section className="card space-y-4" aria-label="Account details">
        <h2 className="section-heading"><span aria-hidden="true" className="section-number">01</span> Profile</h2>
        <div>
          <p className="text-xl font-medium">{user.name}</p>
          <p className="mt-1 break-words text-sm text-ink-soft">{user.email}</p>
        </div>
        <div className="space-y-2 border-t border-line pt-4">
          <p className="field-label">Plan</p>
          <p className="font-medium">{accountTierLabels[tier]}</p>
          {tier === "trial" && user.trialExpiresAt && <p className="section-caption">Pro features until {formatWhen(user.trialExpiresAt)}.</p>}
          {user.role !== "admin" && user.signupSource !== "self" && user.accountTier === "trial" && tier === "basic" && <p className="section-caption">Trial expired. Your account now uses Basic. Your workspace data is unchanged.</p>}
          {!viewing && user.role !== "admin" && <Link href="/billing" className="text-sm text-accent underline">Billing and plans</Link>}
        </div>
        {providers.length > 0 && <div className="space-y-1 border-t border-line pt-4">
          <p className="field-label">Also signs in with</p>
          <p className="text-sm">{providers.join(" and ")}</p>
        </div>}
      </section>
      <section className="space-y-4" aria-label="Account security">
        <h2 className="section-heading"><span aria-hidden="true" className="section-number">02</span> {signIn?.passwordHash ? "Change password" : "Password"}</h2>
        {signIn?.passwordHash ? <PasswordForm /> : <p className="card text-sm text-ink-soft">You sign in with {providers.join(" or ") || "a provider"}. To add a password as well, use <Link href="/forgot-password" className="text-accent underline">Forgot password</Link> from the sign-in page after signing out.</p>}
      </section>
    </div>
    <section aria-label="Browser extension" className="card space-y-5">
      <h2 className="section-heading"><span aria-hidden="true" className="section-number">03</span> Browser extension</h2>
      {viewing ? <p className="section-caption">Return to your own workspace to download the extension. Downloads are unavailable in read-only view.</p> : extensionEnabled ? <>
        <p className="text-sm text-ink-soft">{user.role === "admin" ? "Administrator access is included." : "The extension comes with your plan."} Download again whenever you need to reinstall.</p>
        <a href="/api/extension/download" download className="btn-primary">Download extension ZIP<Icon name="down" size={17} /></a>
        <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-ink-soft">
          <li>Extract the ZIP into a permanent folder on your computer. Keep this folder after installation.</li>
          <li>In desktop Chrome, open <code>chrome://extensions</code>, turn on <strong>Developer mode</strong>, choose <strong>Load unpacked</strong>, and select the extracted <code>capture-extension</code> folder containing <code>manifest.json</code>.</li>
          <li>Pin the extension from Chrome’s extensions menu. Go to <Link href="/settings" className="text-accent underline">Settings</Link> and generate your personal extension key. <strong className="font-medium text-ink">Copy it before you leave that page: the key is shown once and cannot be displayed again.</strong> Paste it into the extension; the workbench address is already filled in. If you lose it, generate another one — that replaces the old key rather than recovering it.</li>
          <li>Create an open role in your workspace if you do not have one yet. Click Connect and check that the extension shows your name and email.</li>
        </ol>
        <p className="section-caption">The ZIP contains no personal key. It saves nothing until an extension key from an account with a plan is pasted into it, and that key stops working when the plan ends or a new key is generated. Installation requires your clicks; a website cannot install it automatically. Unpacked extensions do not update automatically. If your organisation blocks Developer mode, ask your IT administrator.</p>
      </> : <>
        <p className="text-sm leading-relaxed text-ink-soft">The extension comes with every plan and with the trial.</p>
        <Link href="/billing" className="btn-secondary">Choose a plan</Link>
      </>}
    </section>
    {!viewing && user.role === "recruiter" && <section aria-label="Delete your account" className="card">
      <DeleteAccountForm userId={user.id} email={user.email} action={deleteOwnAccount} />
    </section>}
  </div>;
}
