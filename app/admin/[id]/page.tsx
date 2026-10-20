import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { publicUserSelect, requireAdmin } from "@/lib/auth";
import { deleteAccount, issueActivation, setAccountActive, setAccountTier, startViewing } from "@/app/actions/accounts";
import { AccountManagementForm, AccountTierFields, DeleteAccountForm } from "@/components/AccountForms";
import { accountTierLabels, billedPlan, getAccountTier, isPaidPlan, type RecruiterTier } from "@/lib/account-tiers";
import { getWorkspace } from "@/lib/workspace";
import { ActionForm } from "@/components/ActionForm";
import { formatWhen } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function AdminAccountPage({ params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  const { readOnly } = await getWorkspace();
  const user = await db.user.findUnique({
    where: { id: params.id },
    select: { ...publicUserSelect, billingInterval: true, billingPeriodEnd: true, billingCancelAtPeriodEnd: true, createdAt: true },
  });
  if (!user) notFound();
  const events = await db.auditEvent.findMany({ where: { targetUserId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  const actors = await db.user.findMany({ where: { id: { in: Array.from(new Set(events.map((event) => event.actorId))) } }, select: { id: true, name: true } });
  const nameFor = (id: string) => actors.find((actor) => actor.id === id)?.name ?? "Unknown account";
  const tier = getAccountTier(user);
  const expiry = user.trialExpiresAt?.toISOString() ?? null;
  const storedTier: RecruiterTier = isPaidPlan(user.accountTier) || user.accountTier === "trial" ? user.accountTier as RecruiterTier : "basic";
  const billed = billedPlan(user);
  return <div key={user.id} className="max-w-4xl space-y-6">
    <Link href="/admin" className="btn-quiet">Back to accounts</Link>
    <header className="page-header">
      <div><p className="page-eyebrow">Accounts / Manage</p><h1>{user.name}</h1><p className="page-description">Manage this account’s access. Viewing its recruiting workspace is read-only and audited.</p></div>
    </header>
    <article aria-label="Account management" className="card space-y-5">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3"><h2 className="font-medium">{user.name}</h2><span className="rounded border border-line bg-surface px-2 py-1 text-xs font-medium">{accountTierLabels[tier]}</span></div>
        <p className="break-words text-sm text-ink-soft">{user.email} · {user.active ? "Enabled" : "Disabled"}</p>
        {user.role !== "admin" && user.accountTier === "trial" && <p className="section-caption">{tier === "trial" ? "Trial expires" : user.signupSource === "self" ? "Trial expired" : "Trial expired; Basic access applies"}{expiry ? ` · ${expiry.replace("T", " ").replace(":00.000Z", " UTC")}` : " · No valid expiry is set."}</p>}
      </div>
      {tier === "admin" ? <p className="section-caption">Administrator access cannot be changed through account type management.</p> : <section aria-label="Manage account type" className="max-w-xl space-y-3 border-t border-line pt-4">
        {readOnly ? <p className="section-caption">Return to your own workspace to change account types.</p> : <AccountManagementForm action={setAccountTier} submitLabel="Save account type">
          <input type="hidden" name="userId" value={user.id} />
          <AccountTierFields key={`${user.id}-${tier}-${expiry}`} id={user.id} initialTier={storedTier} trialExpiresAt={expiry} />
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
      {user.role === "recruiter" && <section aria-label="Billing" className="space-y-2 border-t border-line pt-4">
        <h3 className="font-medium">Plan and billing</h3>
        <p className="section-caption">{user.signupSource === "self" ? `Signed up themselves on ${formatWhen(user.createdAt)}.` : "Account made by an administrator."}</p>
        {user.billingPlan ? <p className="section-caption">Stripe: {isPaidPlan(user.billingPlan) ? accountTierLabels[user.billingPlan] : user.billingPlan}{user.billingInterval ? ` (${user.billingInterval})` : ""} · {user.billingStatus ?? "unknown"}{billed ? "" : " · not counted"}{user.billingPeriodEnd ? ` · ${user.billingCancelAtPeriodEnd ? "ends" : "renews"} ${formatWhen(user.billingPeriodEnd)}` : ""}.</p> : <p className="section-caption">No subscription.</p>}
        <p className="section-caption">A paid subscription comes before the account type below; the account type is what applies without one.</p>
      </section>}
      {!readOnly && user.role === "recruiter" && <ActionForm action={setAccountActive}>
        <input type="hidden" name="userId" value={user.id} />
        <input type="hidden" name="active" value={String(!user.active)} />
        <button type="submit" className="btn-quiet">{user.active ? "Disable account" : "Enable account"}</button>
      </ActionForm>}
      {!readOnly && user.role === "recruiter" && user.id !== admin.id && <DeleteAccountForm userId={user.id} email={user.email} action={deleteAccount} />}
    </article>
    <section className="card" aria-label="Audit history">
      <h2 className="mb-3 text-lg">Recent account activity</h2>
      <p className="mb-3 text-sm text-ink-soft">The latest 50 account-management and workspace-view events for this account. Passwords, keys and recruiting content are never included.</p>
      {events.length ? <ul className="space-y-2 text-sm">{events.map((event) => <li key={event.id}>{nameFor(event.actorId)} · {event.action.replaceAll("_", " ")} · {user.name} · {formatWhen(event.createdAt)}</li>)}</ul> : <p className="section-caption">No account activity yet.</p>}
    </section>
  </div>;
}
