import type { Metadata } from "next";
import localFont from "next/font/local";
import { getSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { ApplicationShell } from "@/components/ApplicationShell";
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
  title: "Capture",
  description: "A focused workspace for your recruiting pipeline. Keep roles, candidate context and thoughtful follow-ups together — with you in control.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const workspace = session ? await getWorkspace() : null;
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body style={{
        ["--font-display" as string]: "var(--font-sans)",
        ["--font-body" as string]: "var(--font-sans)",
        ["--font-mono" as string]: "var(--font-mono-face)",
      }}>
        <ApplicationShell
          user={session ? { name: session.user.name, email: session.user.email, role: session.user.role } : null}
          viewing={workspace?.readOnly ? { name: workspace.owner.name, email: workspace.owner.email } : null}
          ownerId={workspace?.owner.id}
        >{children}</ApplicationShell>
      </body>
    </html>
  );
}
