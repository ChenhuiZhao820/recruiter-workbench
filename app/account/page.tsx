import Link from "next/link";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace";
import { canUseExtension } from "@/lib/extension-access";
import { DeleteAccountForm, PasswordForm } from "@/components/AccountForms";
import { ExtensionMark } from "@/components/CaptureKeyPanel";
import { accountTierLabels, getAccountTier } from "@/lib/account-tiers";
import { formatWhen } from "@/lib/dates";
import { deleteOwnAccount } from "@/app/actions/accounts";

export const dynamic = "force-dynamic";

// One column of sections, laid out as Settings is: each section's title and
// purpose beside its controls. The extension lives in Settings; this page
// only points there.
export default async function AccountPage() {
  const { user, readOnly, noPlan } = await getWorkspace();
  const viewing = readOnly && !noPlan;
  const extensionEnabled = canUseExtension(user);
  const tier = getAccountTier(user);
  const signIn = await db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true, authAccounts: { select: { providerId: true } } } });
  const providers = Array.from(new Set(signIn?.authAccounts.map((account) => account.providerId === "google" ? "Google" : account.providerId === "microsoft" ? "Microsoft" : null).filter(Boolean)));
  const canDelete = !viewing && user.role === "recruiter";

  return <div>
    <header className="page-header">
      <div>
        <p className="page-eyebrow">Workspace / Account</p>
        <h1>Your account</h1>
        <p className="page-description">Who you sign in as, your plan, your password{canDelete ? ", and closing the account" : ""}.</p>
      </div>
    </header>
    <div className="settings-page">
      <section className="settings-section account-first" aria-label="Account details">
        <div>
          <h2 className="settings-section-title">Profile</h2>
          <p className="settings-section-text">Your sign-in details. The name your messages are signed with is set in <Link href="/settings" className="search-row-role">Settings</Link>.</p>
        </div>
        <div className="settings-section-body">
          <dl className="account-facts">
            <dt>Name</dt>
            <dd>{user.name}</dd>
            <dt>Email</dt>
            <dd className="break-words">{user.email}</dd>
            {providers.length > 0 && <>
              <dt>Also signs in with</dt>
              <dd>{providers.join(" and ")}</dd>
            </>}
          </dl>
          <div className="settings-row">
            <div className="min-w-0">
              <p className="settings-label"><span>Plan</span><span className={`settings-status${tier === "none" ? "" : " is-on"}`}>{accountTierLabels[tier]}</span></p>
              {tier === "trial" && user.trialExpiresAt && <p className="settings-hint">Pro features until {formatWhen(user.trialExpiresAt)}.</p>}
              {tier === "promo" && user.promoProUntil && <p className="settings-hint">Pro features until {formatWhen(user.promoProUntil)}, from a promo code.</p>}
              {user.role !== "admin" && user.signupSource !== "self" && user.accountTier === "trial" && tier === "basic" && <p className="settings-hint">Trial expired. Your account now uses Basic. Your workspace data is unchanged.</p>}
            </div>
            {!viewing && user.role !== "admin" && <Link href="/billing" className="btn-secondary">Manage billing</Link>}
          </div>
        </div>
      </section>

      <section className="settings-section" aria-label="Account security">
        <div>
          <h2 className="settings-section-title">{signIn?.passwordHash ? "Change password" : "Password"}</h2>
          <p className="settings-section-text">{signIn?.passwordHash ? "Your current password first, then the new one twice." : "How you get back in."}</p>
        </div>
        {signIn?.passwordHash
          ? <PasswordForm />
          : <div className="settings-section-body"><p className="settings-hint">You sign in with {providers.join(" or ") || "a provider"}. To add a password as well, use <Link href="/forgot-password" className="search-row-role">Forgot password</Link> from the sign-in page after signing out.</p></div>}
      </section>

      <section className="settings-section" aria-label="Browser extension">
        <div>
          <h2 className="settings-section-title">Browser extension</h2>
          <p className="settings-section-text">Saves a LinkedIn profile to a role when you click it.</p>
        </div>
        <div className="settings-section-body">
          {viewing
            ? <p className="settings-hint">Return to your own workspace to download the extension. Downloads are unavailable in read-only view.</p>
            : <div className="settings-row">
              <div className="settings-integration-head">
                <ExtensionMark />
                <div className="min-w-0 flex-1">
                  <p className="settings-label">{extensionEnabled ? (user.role === "admin" ? "Included with administrator access" : "Included with your plan") : <>Not on this account<span className="settings-status">Needs a plan</span></>}</p>
                  <p className="settings-hint">{extensionEnabled ? "Download it, connect it with a key or switch it off in Settings." : "The extension comes with every plan and with the trial."}</p>
                </div>
              </div>
              {extensionEnabled
                ? <Link href="/settings#connections-heading" className="btn-secondary">Open Settings</Link>
                : <Link href="/billing" className="btn-secondary">Choose a plan</Link>}
            </div>}
        </div>
      </section>

      {canDelete && <section className="settings-section account-danger" aria-label="Delete your account">
        <div>
          <h2 className="settings-section-title">Delete account</h2>
          <p className="settings-section-text">Everything in this workspace goes with it, for good.</p>
        </div>
        <DeleteAccountForm userId={user.id} email={user.email} action={deleteOwnAccount} open />
      </section>}
    </div>
  </div>;
}
