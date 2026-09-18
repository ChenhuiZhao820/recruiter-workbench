import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { publicUserSelect, requireAdmin } from "@/lib/auth";
import { issueActivation, setAccountActive, setAccountTier, startViewing } from "@/app/actions/accounts";
import { AccountManagementForm, AccountTierFields, ExtensionCodeForm } from "@/components/AccountForms";
import { accountTierLabels, getAccountTier } from "@/lib/account-tiers";
import { getWorkspace } from "@/lib/workspace";
import { ActionForm } from "@/components/ActionForm";
import { formatWhen } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function AdminAccountPage({ params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  const { readOnly } = await getWorkspace();
  const user = await db.user.findUnique({
    where: { id: params.id },
    select: { ...publicUserSelect, extensionAccess: { select: { activatedAt: true, expiresAt: true } } },
  });
  if (!user) notFound();
  const events = await db.auditEvent.findMany({ where: { targetUserId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  const actors = await db.user.findMany({ where: { id: { in: Array.from(new Set(events.map((event) => event.actorId))) } }, select: { id: true, name: true } });
  const nameFor = (id: string) => actors.find((actor) => actor.id === id)?.name ?? "Unknown account";
  const tier = getAccountTier(user);
  const expiry = user.trialExpiresAt?.toISOString() ?? null;
  return <div key={user.id} className="max-w-4xl space-y-6">
    <Link href="/admin" className="btn-quiet">Back to accounts</Link>
    <header className="page-header">
      <div><p className="page-eyebrow">Accounts / Manage</p><h1>{user.name}</h1><p className="page-description">Manage this account’s access. Viewing its recruiting workspace is read-only and audited.</p></div>
    </header>
    <article aria-label="Account management" className="card space-y-5">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3"><h2 className="font-medium">{user.name}</h2><span className="rounded border border-line bg-surface px-2 py-1 text-xs font-medium">{accountTierLabels[tier]}</span></div>
        <p className="break-words text-sm text-ink-soft">{user.email} · {user.active ? "Enabled" : "Disabled"}</p>
        {user.role !== "admin" && user.accountTier === "trial" && <p className="section-caption">{tier === "trial" ? "Trial expires" : "Trial expired; Basic access applies"}{expiry ? ` · ${expiry.replace("T", " ").replace(":00.000Z", " UTC")}` : " · No valid expiry is set."}</p>}
      </div>
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
        <h3 className="font-medium">Extension access</h3>
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
    </article>
    <section className="card" aria-label="Audit history">
      <h2 className="mb-3 text-lg">Recent account activity</h2>
      <p className="mb-3 text-sm text-ink-soft">The latest 50 account-management and workspace-view events for this account. Passwords, keys and recruiting content are never included.</p>
      {events.length ? <ul className="space-y-2 text-sm">{events.map((event) => <li key={event.id}>{nameFor(event.actorId)} · {event.action.replaceAll("_", " ")} · {user.name} · {formatWhen(event.createdAt)}</li>)}</ul> : <p className="section-caption">No account activity yet.</p>}
    </section>
  </div>;
}
