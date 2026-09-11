import Link from "next/link";
import { getWorkspace } from "@/lib/workspace";
import { db } from "@/lib/db";
import { canUseExtension } from "@/lib/extension-access";
import { ExtensionActivationForm, PasswordForm } from "@/components/AccountForms";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const { user, readOnly } = await getWorkspace();
  const access = await db.extensionAccess.findUnique({ where: { userId: user.id }, select: { activatedAt: true, expiresAt: true } });
  const extensionEnabled = canUseExtension({ ...user, extensionAccess: access });
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
    <section aria-label="Browser extension" className="card space-y-5">
      <h2 className="section-heading"><span aria-hidden="true" className="section-number">03</span> Browser extension</h2>
      {readOnly ? <p className="section-caption">Return to your own workspace to manage extension access. Downloads and activation are unavailable in read-only view.</p> : extensionEnabled ? <>
        <p className="text-sm text-ink-soft">{user.role === "admin" ? "Administrator access is included." : "Extension access is activated for your account."} Download again whenever you need to reinstall. Your activation code is not needed again.</p>
        <a href="/api/extension/download" download className="btn-primary">Download extension ZIP<Icon name="down" size={17} /></a>
        <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-ink-soft">
          <li>Extract the ZIP into a permanent folder on your computer. Keep this folder after installation.</li>
          <li>In desktop Chrome, open <code>chrome://extensions</code>, turn on <strong>Developer mode</strong>, choose <strong>Load unpacked</strong>, and select the extracted <code>capture-extension</code> folder containing <code>manifest.json</code>.</li>
          <li>Pin Capture from Chrome’s extensions menu. Go to <Link href="/settings" className="text-accent underline">Settings</Link> and generate your personal capture key. <strong className="font-medium text-ink">Copy it before you leave that page: the key is shown once and cannot be displayed again.</strong> Paste it into the extension; the workbench address is already filled in. If you lose it, generate another one — that replaces the old key rather than recovering it.</li>
          <li>Create an open role in your workspace if you do not have one yet. Click Connect and check that the extension shows your name and email.</li>
        </ol>
        <p className="section-caption">The ZIP contains no personal key or activation code. Installation requires your clicks; a website cannot install it automatically. Unpacked extensions do not update automatically. Download a fresh ZIP when an update is available. If your organisation blocks Developer mode, ask your IT administrator.</p>
      </> : <>
        <p className="text-sm leading-relaxed text-ink-soft">Ask your administrator for your account’s extension activation code. It can be used once, by this account only, within 7 days of being issued. A replacement invalidates the previous code.</p>
        {access?.expiresAt && access.expiresAt <= new Date() && <p role="status" className="text-sm text-ink-soft">Your activation code has expired. Ask your administrator for a replacement.</p>}
        <ExtensionActivationForm />
        <p className="section-caption">Activation unlocks downloading and using the extension. After installation, generate a separate personal capture key in Settings.</p>
      </>}
    </section>
  </div>;
}
