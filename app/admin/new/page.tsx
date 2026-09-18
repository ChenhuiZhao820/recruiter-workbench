import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { createAccount } from "@/app/actions/accounts";
import { AccountManagementForm, AccountTierFields } from "@/components/AccountForms";

export const dynamic = "force-dynamic";

export default async function NewAccountPage() {
  await requireAdmin();
  const { readOnly } = await getWorkspace();
  return <div className="max-w-4xl space-y-6">
    <Link href="/admin" className="btn-quiet">Back to accounts</Link>
    <header className="page-header">
      <div><p className="page-eyebrow">Accounts / Create</p><h1>Create an account</h1><p className="page-description">Set up an account and share its one-time password setup link privately.</p></div>
    </header>
    <section className="card form-panel max-w-xl" aria-label="Create account">
      {readOnly ? <p className="section-caption">Return to your own workspace to create accounts.</p> : <AccountManagementForm action={createAccount} submitLabel="Create account">
        <div><label htmlFor="new-name" className="field-label">Name</label><input id="new-name" name="name" maxLength={120} required className="field-input" /></div>
        <div><label htmlFor="new-email" className="field-label">Email</label><input id="new-email" name="email" type="email" maxLength={254} required className="field-input" /></div>
        <AccountTierFields id="new-account" />
      </AccountManagementForm>}
    </section>
  </div>;
}
