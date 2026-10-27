"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logout } from "@/app/actions/auth";
import { stopViewing } from "@/app/actions/accounts";
import { Icon } from "@/components/Icon";
import { ActivityBell, UnreadBadge, useUnreadActivity } from "@/components/ActivityBell";

const setupNavigation = { href: "/getting-started", label: "Getting started", icon: "spark" } as const;

const navigation = [
  { href: "/", label: "Roles", icon: "roles" },
  { href: "/people", label: "People", icon: "people" },
  { href: "/shortlists", label: "Shortlists", icon: "shortlist" },
  { href: "/searches", label: "Searches", icon: "search" },
  { href: "/templates", label: "Templates", icon: "message" },
  { href: "/followups", label: "Follow-ups", icon: "clock" },
  { href: "/notifications", label: "Notifications", icon: "bell" },
  { href: "/billing", label: "Billing", icon: "card" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

type Identity = { name: string; email: string; role: string };

export function ApplicationShell({ user, viewing, plan = null, setupPending = false, releasePending = false, unreadActivity = 0, ownerId, children }: {
  user: Identity | null;
  viewing: { name: string; email: string } | null;
  // A trial's days left, or a plan that has ended (the workspace is then
  // read-only), and whether the promo code can still be redeemed.
  plan?: { ended: boolean; daysLeft: number; promo?: boolean } | null;
  // Setup is only advertised while it is unfinished; a finished workspace
  // keeps the page but loses the nav entry.
  setupPending?: boolean;
  // An unread release, for an account already signed in when it shipped. It
  // is one link in the top bar rather than an interruption, and it leaves as
  // soon as the release is read.
  releasePending?: boolean;
  // What clients did that the recruiter has not looked at yet.
  unreadActivity?: number;
  ownerId?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);
  const unread = useUnreadActivity(unreadActivity);
  // The terms and privacy policy read the same signed in or not.
  const publicPage = !user || pathname === "/welcome" || pathname === "/terms" || pathname === "/privacy";
  const active = (href: string) => href === "/" ? pathname === "/" || pathname.startsWith("/roles") : pathname.startsWith(href);
  const items = setupPending ? [setupNavigation, ...navigation] : navigation;
  const pageName = items.find((item) => active(item.href))?.label ?? (pathname.startsWith("/getting-started") ? setupNavigation.label : pathname.startsWith("/admin") ? "Accounts" : pathname.startsWith("/account") ? "Your account" : pathname.startsWith("/whats-new") ? "What’s new" : pathname.startsWith("/candidates/") && pathname.endsWith("/screening") ? "Screening" : pathname.startsWith("/candidates/") && pathname.endsWith("/interview") ? "Interview" : "Outreach");
  const initials = user?.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "C";

  // A candidate's booking page and a client's shortlist: the product's mark
  // and nothing to navigate to, whoever is signed in on this browser.
  if (pathname.startsWith("/book/") || pathname.startsWith("/s/")) return <div className="public-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="site-header">
      <div className="site-nav"><span className="brand"><Image className="brand-logo" src="/brand/retrivr-logo.png" alt="Retrivr" width={953} height={215} unoptimized /></span></div>
    </header>
    <main id="main-content" className="public-main">{children}</main>
  </div>;

  // The marketing page brings its own header and footer under the Retrivr
  // name; the other public pages (sign-in, activation) share this one.
  if ((!user && pathname === "/") || pathname === "/welcome") return <div className="public-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    {children}
  </div>;

  if (publicPage) return <div className="public-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="site-header">
      <div className="site-nav">
        <Link href="/welcome" className="brand" aria-label="Retrivr"><Image className="brand-logo" src="/brand/retrivr-logo.png" alt="Retrivr" width={953} height={215} unoptimized /></Link>
        <button type="button" className="mobile-nav-toggle" aria-label="Toggle navigation" aria-expanded={menuOpen} aria-controls="public-navigation" onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? "close" : "menu"} /></button>
        <nav id="public-navigation" aria-label="Main" className={`public-navigation ${menuOpen ? "is-open" : ""}`}>
          <Link href="/welcome#how" onClick={() => setMenuOpen(false)}>Features</Link>
          <Link href="/welcome#pricing" onClick={() => setMenuOpen(false)}>Pricing</Link>
          <Link href="/welcome#faq" onClick={() => setMenuOpen(false)}>FAQ</Link>
          <Link href="/welcome#contact" onClick={() => setMenuOpen(false)}>Contact</Link>
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
        <Link href="/" className="brand" aria-label="Retrivr"><Image className="brand-logo" src="/brand/retrivr-logo.png" alt="Retrivr" width={953} height={215} unoptimized /></Link>
        <button type="button" className="mobile-nav-toggle" aria-label="Toggle navigation" aria-expanded={menuOpen} aria-controls="workspace-navigation" onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? "close" : "menu"} /></button>
      </div>
      <div id="workspace-navigation" className={`sidebar-content ${menuOpen ? "is-open" : ""}`}>
        <div className="workspace-switcher"><span className="workspace-symbol"><Icon name="grid" size={17} /></span><div><strong>{viewing ? viewing.name : "My workspace"}</strong><span>{viewing ? "Read-only view" : "Recruiting, in focus"}</span></div><Icon name="lock" size={14} /></div>
        <p className="nav-label">Workspace</p>
        <nav aria-label="Main" className="workspace-navigation">
          {items.map((item) => <Link key={item.href} href={item.href} className={active(item.href) ? "nav-item is-active" : "nav-item"} aria-current={active(item.href) ? "page" : undefined}><Icon name={item.icon} size={19} /><span>{item.label}</span>{item.href === "/notifications" && <UnreadBadge count={unread} />}{active(item.href) && <span className="nav-active-dot" aria-hidden="true" />}</Link>)}
          {user.role === "admin" && <><p className="nav-label admin-nav-label">Administration</p><Link href="/admin" className={pathname.startsWith("/admin") ? "nav-item is-active" : "nav-item"} aria-current={pathname.startsWith("/admin") ? "page" : undefined}><Icon name="shield" size={19} /><span>Accounts</span></Link></>}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/account" className={pathname.startsWith("/account") ? "account-link is-active" : "account-link"} aria-current={pathname.startsWith("/account") ? "page" : undefined} title={`Your account: ${user.email}`}><span className="avatar">{initials}</span><span><strong>{user.name}</strong><small>{user.email}</small></span></Link>
          <form action={logout}><button type="submit" className="sidebar-signout"><Icon name="logout" size={16} />Sign out</button></form>
        </div>
      </div>
    </header>
    <div className="workspace-body">
      <div className="workspace-topbar"><div className="breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span><strong>{pageName}</strong></div><span className="workspace-status">{releasePending && <Link href="/whats-new" className="topbar-news">What&rsquo;s new</Link>}{user && <ActivityBell unread={unread} />}<span className="status-dot" />{viewing || plan?.ended ? "Read-only" : "Private workspace"}</span></div>
      {plan && !pathname.startsWith("/billing") && <div role="status" className={`plan-banner${plan.ended ? " plan-banner-ended" : ""}`}><p>{plan.ended
        ? "Your trial has ended. Everything you saved is here to read, export or delete; choose a plan to keep working."
        : `Pro trial: ${plan.daysLeft} ${plan.daysLeft === 1 ? "day" : "days"} left.`}</p>{plan.promo && <Link href="/billing?tab=plans&promo=1" className="plan-banner-promo">Have a promo code?</Link>}<Link href="/billing" className="btn-secondary">{plan.ended ? "Choose a plan" : "See plans"}</Link></div>}
      {viewing && <div role="status" className="readonly-banner"><Icon name="eye" /><p>Read-only workspace: <strong>{viewing.name}</strong> ({viewing.email}). You are still signed in as {user.name}.</p><form action={stopViewing}><button type="submit" className="btn-secondary">Return to my workspace</button></form></div>}
      <main id="main-content" key={ownerId} className="workspace-main">{children}</main>
      <footer className="workspace-footer"><span>Retrivr — recruiting, in focus.</span><span>Prepared by software. Decided by you.</span></footer>
    </div>
  </div>;
}
