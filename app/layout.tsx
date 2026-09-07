import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
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
  title: "Basanite Recruiter Workbench",
  description: "A private workspace for your recruiting pipeline.",
};

const NAV = [
  { href: "/", label: "Roles" },
  { href: "/searches", label: "Searches" },
  { href: "/templates", label: "Templates" },
  { href: "/followups", label: "Follow-ups" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body
        style={{
          ["--font-display" as string]: "var(--font-sans)",
          ["--font-body" as string]: "var(--font-sans)",
          ["--font-mono" as string]: "var(--font-mono-face)",
        }}
      >
        <div className="min-h-screen">
          <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
              <Link
                href="/"
                className="font-mono text-sm font-medium uppercase tracking-[0.18em] text-ink"
              >
                Basanite
              </Link>
              <nav aria-label="Main">
                <ul className="flex flex-wrap gap-x-4 gap-y-1">
                  {NAV.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="text-sm text-ink-soft transition-colors hover:text-accent"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
