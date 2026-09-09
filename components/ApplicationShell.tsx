"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logout } from "@/app/actions/auth";
import { stopViewing } from "@/app/actions/accounts";
import { CaptureMark, Icon } from "@/components/Icon";

const navigation = [
  { href: "/", label: "Roles", icon: "roles" },
  { href: "/searches", label: "Searches", icon: "search" },
  { href: "/templates", label: "Templates", icon: "message" },
  { href: "/followups", label: "Follow-ups", icon: "clock" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

type Identity = { name: string; email: string; role: string };

export function ApplicationShell({ user, viewing, ownerId, children }: {
  user: Identity | null;
  viewing: { name: string; email: string } | null;
  ownerId?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);
  const publicPage = !user || pathname === "/welcome";
  const active = (href: string) => href === "/" ? pathname === "/" || pathname.startsWith("/roles") : pathname.startsWith(href);
  const pageName = navigation.find((item) => active(item.href))?.label ?? (pathname.startsWith("/admin") ? "Accounts" : pathname.startsWith("/account") ? "Your account" : "Outreach");
  const initials = user?.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "C";

  if (publicPage) return <div className="public-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="site-header">
      <div className="site-nav">
        <Link href="/welcome" className="brand" aria-label="Capture"><CaptureMark /><span>Capture</span></Link>
        <button type="button" className="mobile-nav-toggle" aria-label="Toggle navigation" aria-expanded={menuOpen} aria-controls="public-navigation" onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? "close" : "menu"} /></button>
        <nav id="public-navigation" aria-label="Main" className={`public-navigation ${menuOpen ? "is-open" : ""}`}>
          <Link href="/welcome#features" onClick={() => setMenuOpen(false)}>Features</Link>
          <Link href="/welcome#workflow" onClick={() => setMenuOpen(false)}>Workflow</Link>
          <Link href="/welcome#principles" onClick={() => setMenuOpen(false)}>Our approach</Link>
          <Link href="/welcome#faq" onClick={() => setMenuOpen(false)}>FAQ</Link>
          <Link href={user ? "/" : "/login"} className="btn-dark">{user ? "Open workspace" : "Sign in"}<Icon name="arrow" size={16} /></Link>
        </nav>
      </div>
    </header>
    <main id="main-content" className="public-main">{children}</main>
  </div>;

  return <div className="application-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="app-sidebar">
      <div className="sidebar-brand-row">
        <Link href="/" className="brand" aria-label="Capture"><CaptureMark /><span>Capture</span></Link>
        <button type="button" className="mobile-nav-toggle" aria-label="Toggle navigation" aria-expanded={menuOpen} aria-controls="workspace-navigation" onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? "close" : "menu"} /></button>
      </div>
      <div id="workspace-navigation" className={`sidebar-content ${menuOpen ? "is-open" : ""}`}>
        <div className="workspace-switcher"><span className="workspace-symbol"><Icon name="grid" size={17} /></span><div><strong>{viewing ? viewing.name : "My workspace"}</strong><span>{viewing ? "Read-only view" : "Recruiting, in focus"}</span></div><Icon name="lock" size={14} /></div>
        <p className="nav-label">Workspace</p>
        <nav aria-label="Main" className="workspace-navigation">
          {navigation.map((item) => <Link key={item.href} href={item.href} className={active(item.href) ? "nav-item is-active" : "nav-item"} aria-current={active(item.href) ? "page" : undefined}><Icon name={item.icon} size={19} /><span>{item.label}</span>{active(item.href) && <span className="nav-active-dot" aria-hidden="true" />}</Link>)}
          {user.role === "admin" && <><p className="nav-label admin-nav-label">Administration</p><Link href="/admin" className={pathname.startsWith("/admin") ? "nav-item is-active" : "nav-item"} aria-current={pathname.startsWith("/admin") ? "page" : undefined}><Icon name="shield" size={19} /><span>Accounts</span></Link></>}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note"><span className="status-dot" /><p>Your judgement.<br /><strong>Your next move.</strong></p><Link href="/welcome" aria-label="About Capture"><Icon name="external" size={16} /></Link></div>
          <Link href="/account" className="account-link"><span className="avatar">{initials}</span><span><strong>{user.name}</strong><small>{user.email}</small></span></Link>
          <form action={logout}><button type="submit" className="sidebar-signout"><Icon name="logout" size={16} />Sign out</button></form>
        </div>
      </div>
    </header>
    <div className="workspace-body">
      <div className="workspace-topbar"><div className="breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span><strong>{pageName}</strong></div><span className="workspace-status"><span className="status-dot" />{viewing ? "Read-only" : "Private workspace"}</span></div>
      {viewing && <div role="status" className="readonly-banner"><Icon name="eye" /><p>Read-only workspace: <strong>{viewing.name}</strong> ({viewing.email}). You are still signed in as {user.name}.</p><form action={stopViewing}><button type="submit" className="btn-secondary">Return to my workspace</button></form></div>}
      <main id="main-content" key={ownerId} className="workspace-main">{children}</main>
      <footer className="workspace-footer"><span>Capture — recruiting, in focus.</span><span>Prepared by software. Decided by you.</span></footer>
    </div>
  </div>;
}
