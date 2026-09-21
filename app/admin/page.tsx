import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { accountTierLabels, getAccountTier } from "@/lib/account-tiers";
import { getWorkspace } from "@/lib/workspace";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdmin();
  const { readOnly } = await getWorkspace();
  const users = await db.user.findMany({
    select: { id: true, name: true, email: true, role: true, accountTier: true, trialExpiresAt: true },
    orderBy: { createdAt: "asc" },
  });
  return <div className="space-y-6">
    <header className="page-header">
      <div><p className="page-eyebrow">Administration / Accounts</p><h1>Account administration</h1><p className="page-description">Choose an account to view its details and manage access.</p></div>
      {!readOnly && <Link href="/admin/new" className="btn-primary"><Icon name="plus" size={18} />Create an account</Link>}
    </header>
    <section aria-label="Accounts" className="space-y-3">
      <h2 className="text-lg">Accounts ({users.length})</h2>
      {users.map((user) => <article key={user.id}>
        <Link href={`/admin/${encodeURIComponent(user.id)}`} prefetch={false} className="card block space-y-3 transition-colors hover:border-accent">
          <div className="flex flex-wrap items-center gap-3"><h3 className="font-medium">{user.name}</h3><span className="rounded border border-line bg-surface px-2 py-1 text-xs font-medium">{accountTierLabels[getAccountTier(user)]}</span></div>
          <p className="break-words text-sm text-ink-soft">{user.email}</p>
        </Link>
      </article>)}
    </section>
  </div>;
}
