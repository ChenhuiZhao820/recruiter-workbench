import type { Metadata } from "next";
import localFont from "next/font/local";
import { getSession } from "@/lib/auth";
import { getOnboardingStatus } from "@/lib/onboarding";
import { getWorkspace } from "@/lib/workspace";
import { ApplicationShell } from "@/components/ApplicationShell";
import { hasSeenCurrentRelease } from "@/lib/release";
import { unreadCount } from "@/lib/notifications";
import { getAccountTier } from "@/lib/account-tiers";
import { promoEndsAt } from "@/lib/promo-core.mjs";
import "./globals.css";

// Vendored rather than fetched from Google at build time: next/font/google
// downloads during compilation, which stalls cold builds on a slow network
// and silently falls back to system fonts when the fetch times out.
// Two variable faces cover the whole interface.
const sans = localFont({
  src: "./fonts/schibsted-grotesk-variable.woff2",
  weight: "400 900",
  style: "normal",
  display: "swap",
  variable: "--font-sans",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

const mono = localFont({
  src: "./fonts/jetbrains-mono-variable.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-mono-face",
  fallback: ["ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
});

export const metadata: Metadata = {
  title: "Retrivr",
  description: "A focused workspace for your recruiting pipeline. Keep roles, candidate context and thoughtful follow-ups together — with you in control.",
};

export default async function RootLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  const session = await getSession();
  const workspace = session ? await getWorkspace() : null;
  // Setup belongs to the signed-in account, so an admin reading someone else's
  // workspace is not offered their setup steps.
  const setup = workspace && !workspace.readOnly ? await getOnboardingStatus() : null;
  // Signed in before the release shipped, so sign-in never took them past it.
  // A brand new account is still setting up; what changed since a version they
  // never used is not news to them.
  const unreadRelease = Boolean(setup && !setup.untouched && !(await hasSeenCurrentRelease(workspace!.owner.id)));
  // The release is one more notification on the bell until it is read.
  const unreadActivity = (workspace ? await unreadCount(workspace.owner.id) : 0) + (unreadRelease ? 1 : 0);
  // The account's own plan, said once at the top: days left on a trial (or a
  // promo code's free Pro), or that it has ended, with the promo code offered
  // while it still works. Never for an administrator viewing someone else.
  const ownTier = workspace && (workspace.noPlan || !workspace.readOnly) ? getAccountTier(workspace.user) : null;
  const freeUntil = ownTier === "trial" ? workspace?.user.trialExpiresAt : ownTier === "promo" ? workspace?.user.promoProUntil : null;
  const plan = workspace?.noPlan ? { ended: true, daysLeft: 0, promo: !workspace.user.promoProUntil && new Date() < promoEndsAt() }
    : freeUntil ? { ended: false, daysLeft: Math.max(1, Math.ceil((freeUntil.getTime() - Date.now()) / 86_400_000)) }
    : null;
  return (
    <html lang="en-GB" className={`${sans.variable} ${mono.variable}`}>
      <body style={{
        ["--font-display" as string]: "var(--font-sans)",
        ["--font-body" as string]: "var(--font-sans)",
        ["--font-mono" as string]: "var(--font-mono-face)",
      }}>
        <ApplicationShell
          user={session ? { name: session.user.name, email: session.user.email, role: session.user.role } : null}
          viewing={workspace?.readOnly && !workspace.noPlan ? { name: workspace.owner.name, email: workspace.owner.email } : null}
          plan={plan}
          setupPending={Boolean(setup && !setup.complete)}
          releasePending={unreadRelease}
          unreadActivity={unreadActivity}
          ownerId={workspace?.owner.id}
        >{children}</ApplicationShell>
        {modal}
      </body>
    </html>
  );
}
