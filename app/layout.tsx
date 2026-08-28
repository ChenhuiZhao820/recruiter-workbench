import type { Metadata } from "next";
import { DM_Serif_Display, Inter, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const display = DM_Serif_Display({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display-google",
});
const body = Inter({ subsets: ["latin"], variable: "--font-body-google" });
const mono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-mono-google",
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
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body
        style={{
          ["--font-display" as string]:
            "var(--font-display-google), Georgia, serif",
          ["--font-body" as string]: "var(--font-body-google), system-ui, sans-serif",
          ["--font-mono" as string]:
            "var(--font-mono-google), ui-monospace, monospace",
        }}
      >
        <div className="min-h-screen">
          <header className="border-b border-line bg-white">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
              <Link href="/" className="font-display text-xl text-ink">
                Basanite
              </Link>
              <nav aria-label="Main">
                <ul className="flex flex-wrap gap-x-4 gap-y-1">
                  {NAV.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="font-mono text-sm tracking-wide text-ink hover:text-brass"
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
