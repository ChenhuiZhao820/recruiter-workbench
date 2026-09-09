import { requireUser } from "@/lib/auth";
import { PasswordForm } from "@/components/AccountForms";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();
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
      </section>
      <section className="space-y-4" aria-label="Account security">
        <h2 className="section-heading"><span aria-hidden="true" className="section-number">02</span> Change password</h2>
        <PasswordForm />
      </section>
    </div>
  </div>;
}
