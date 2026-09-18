import { db } from "@/lib/db";
import { publicUserSelect, requireAdmin } from "@/lib/auth";
import { createAccount, issueActivation, setAccountActive, setAccountTier, startViewing } from "@/app/actions/accounts";
import { AccountManagementForm, AccountTierFields, ExtensionCodeForm } from "@/components/AccountForms";
import { accountTierLabels, getAccountTier } from "@/lib/account-tiers";
import { getWorkspace } from "@/lib/workspace";
import { ActionForm } from "@/components/ActionForm";
import { formatWhen } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await requireAdmin();
  const { readOnly } = await getWorkspace();
  const [users, events] = await Promise.all([
    db.user.findMany({ select: { ...publicUserSelect, createdAt: true, extensionAccess: { select: { activatedAt: true, expiresAt: true } } }, orderBy: { createdAt: "asc" } }),
    db.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const nameFor = (id: string | null) => users.find((user) => user.id === id)?.name ?? "Unknown account";
  return <div className="space-y-6">
    <div><h1 className="text-3xl">Account administration</h1><p className="mt-2 text-ink-soft">Manage access here. Viewing another user’s recruiting workspace is read-only and audited.</p></div>
    <section aria-label="Account types" className="card space-y-2 text-sm text-ink-soft">
      <h2 className="text-lg text-ink">Account types</h2>
      <p><strong>Admin</strong> manages accounts and includes Pro access. Administrator roles are managed separately.</p>
      <p><strong>Basic</strong> includes the standard workspace. <strong>Pro</strong> additionally grants access to Pro-only features.</p>
      <p><strong>Trial</strong> has the same feature access as Pro until its expiry, then automatically uses Basic. Existing workspace data and extension activation are unchanged.</p>
    </section>
    <section className="card max-w-xl space-y-4" aria-label="Create account">
      <h2 className="text-lg">Create an account</h2>
      {readOnly ? <p className="section-caption">Return to your own workspace to create accounts.</p> : <AccountManagementForm action={createAccount} submitLabel="Create account">
        <div><label htmlFor="new-name" className="field-label">Name</label><input id="new-name" name="name" maxLength={120} required className="field-input" /></div>
        <div><label htmlFor="new-email" className="field-label">Email</label><input id="new-email" name="email" type="email" maxLength={254} required className="field-input" /></div>
        <AccountTierFields id="new-account" />
      </AccountManagementForm>}
    </section>
    <section aria-label="Accounts" className="space-y-3">
      <h2 className="text-lg">Accounts ({users.length})</h2>
      {users.map((user) => {
        const tier = getAccountTier(user);
        const expiry = user.trialExpiresAt?.toISOString() ?? null;
        return <article key={user.id} className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3"><h3 className="font-medium">{user.name}</h3><span className="rounded border border-line bg-surface px-2 py-1 text-xs font-medium">{accountTierLabels[tier]}</span></div>
        <p className="break-words text-sm text-ink-soft">{user.email} · {user.active ? "Enabled" : "Disabled"}</p>
        {user.role !== "admin" && user.accountTier === "trial" && <p className="section-caption">{tier === "trial" ? "Trial expires" : "Trial expired; Basic access applies"}{expiry ? ` · ${expiry.replace("T", " ").replace(":00.000Z", " UTC")}` : " · No valid expiry is set."}</p>}
        {tier === "admin" ? <p className="section-caption">Administrator access cannot be changed through account type management.</p> : <section aria-label="Manage account type" className="max-w-xl space-y-3 border-t border-line pt-4">
          {readOnly ? <p className="section-caption">Return to your own workspace to change account types.</p> : <AccountManagementForm action={setAccountTier} submitLabel="Save account type">
            <input type="hidden" name="userId" value={user.id} />
            <AccountTierFields key={`${user.id}-${tier}-${expiry}`} id={user.id} initialTier={tier} trialExpiresAt={expiry} />
          </AccountManagementForm>}
        </section>}
        {user.id !== admin.id && <form action={startViewing}>
          <input type="hidden" name="userId" value={user.id} />
          <button type="submit" className="btn-secondary">View workspace (read-only)</button>
        </form>}
        {!readOnly && user.active && <details>
          <summary className="cursor-pointer text-sm text-ink-soft">Activation / password reset</summary>
          <div className="mt-3"><AccountManagementForm action={issueActivation} submitLabel="Generate setup/reset link"><input type="hidden" name="userId" value={user.id} /></AccountManagementForm></div>
        </details>}
        <section aria-label="Extension access" className="space-y-3 border-t border-line pt-4">
          <h4 className="font-medium">Extension access</h4>
          {user.role === "admin" ? <p className="section-caption">Included for administrators.</p> : user.extensionAccess?.activatedAt ?
            <p className="section-caption">Activated {formatWhen(user.extensionAccess.activatedAt)}. This account can download and use the extension{!user.active ? " once re-enabled" : ""}.</p> : <>
              <p className="section-caption">{user.extensionAccess?.expiresAt ? `${user.extensionAccess.expiresAt <= new Date() ? "Code expired" : "Code expires"} ${formatWhen(user.extensionAccess.expiresAt)}.` : "Not activated. No extension code has been issued."} Each code belongs to this account only and expires after 7 days.</p>
              {user.active ? readOnly ? <p className="section-caption">Return to your own workspace to issue extension codes.</p> : <ExtensionCodeForm userId={user.id} issued={Boolean(user.extensionAccess)} /> : <p className="section-caption">Enable this account before issuing a code.</p>}
            </>}
        </section>
        {!readOnly && user.role === "recruiter" && <ActionForm action={setAccountActive}>
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="active" value={String(!user.active)} />
          <button type="submit" className="btn-quiet">{user.active ? "Disable account" : "Enable account"}</button>
        </ActionForm>}
      </article>; })}
    </section>
    <section className="card" aria-label="Audit history">
      <h2 className="mb-3 text-lg">Recent account activity</h2>
      <p className="mb-3 text-sm text-ink-soft">The latest 50 account-management and workspace-view events. Passwords, keys and recruiting content are never included.</p>
      <ul className="space-y-2 text-sm">{events.map((event) => <li key={event.id}>{nameFor(event.actorId)} · {event.action.replaceAll("_", " ")} · {nameFor(event.targetUserId)} · {formatWhen(event.createdAt)}</li>)}</ul>
    </section>
  </div>;
}
