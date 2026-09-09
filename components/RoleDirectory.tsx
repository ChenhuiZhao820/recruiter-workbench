"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";

type RoleSummary = { id: string; title: string; client: string | null; candidateCount: number; followUps: number; updatedAt: string };

export function RoleDirectory({ roles, closedRoles, readOnly }: { roles: RoleSummary[]; closedRoles: RoleSummary[]; readOnly: boolean }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("updated");
  const searchRef = useRef<HTMLInputElement>(null);
  const filter = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (items: RoleSummary[]) => items.filter((role) => `${role.title} ${role.client || ""}`.toLowerCase().includes(term)).sort((a, b) => sort === "name" ? a.title.localeCompare(b.title) : sort === "candidates" ? b.candidateCount - a.candidateCount || a.title.localeCompare(b.title) : b.updatedAt.localeCompare(a.updatedAt));
  }, [query, sort]);
  const visible = filter(roles);
  const closed = filter(closedRoles);
  const renderRole = (role: RoleSummary, isClosed = false) => <li key={role.id}>
    <Link href={`/roles/${role.id}`} className={`card role-card ${isClosed ? "role-card-closed" : ""}`}>
      <div className="role-card-top"><span className="role-monogram">{role.title.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><span className={`role-state ${isClosed ? "" : "is-open"}`}><i />{isClosed ? "Closed" : "Open"}</span><Icon name="external" size={17} /></div>
      <h3>{role.title}</h3>
      <p className="role-client">{role.client || "Independent search"}</p>
      <div className="role-card-stats"><span><Icon name="people" size={15} />{role.candidateCount} {role.candidateCount === 1 ? "candidate" : "candidates"}</span><span className={!isClosed && role.followUps ? "text-accent" : ""}><Icon name="clock" size={15} />{isClosed ? "Closed - not in Follow-ups" : role.followUps ? `${role.followUps} to follow up today` : "no follow-ups today"}</span></div>
    </Link>
  </li>;

  const clearSearch = () => {
    setQuery("");
    if (searchRef.current) searchRef.current.value = "";
  };

  return <section className="role-directory" aria-label="Role directory">
    <div className="directory-toolbar"><div className="search-field"><Icon name="search" size={18} /><label htmlFor="role-search" className="sr-only">Search roles</label><input id="role-search" ref={searchRef} type="search" defaultValue="" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search roles or clients…" /></div><div className="sort-field"><label htmlFor="role-sort" className="sr-only">Sort roles</label><select id="role-sort" value={sort} onChange={(event) => setSort(event.target.value)}><option value="updated">Recently updated</option><option value="name">Role name</option><option value="candidates">Most candidates</option></select></div></div>
    <div className="directory-label"><h2>Open roles <span>{visible.length}</span></h2><span>From brief to shortlist</span></div>
    {visible.length ? <ul className="role-grid">{visible.map((role) => renderRole(role))}</ul> : <div className="card empty-state"><span className="empty-state-icon"><Icon name={query ? "search" : "roles"} size={26} /></span><h3>{query ? "No matching roles" : "Your next search starts here."}</h3><p>{query ? "Try another title or client name." : "No open roles yet. Start by creating one."}</p>{query ? <button type="button" className="btn-secondary" onClick={clearSearch}>Clear search</button> : <><p>A role holds its briefing, its candidate list, and its saved searches, all in one place.</p>{!readOnly && <Link href="/roles/new" className="btn-secondary">Create your first role<Icon name="plus" size={16} /></Link>}</>}</div>}
    {closedRoles.length > 0 && <details className="closed-roles"><summary>Closed roles ({closedRoles.length})<Icon name="down" size={16} /></summary>{closed.length ? <ul className="role-grid">{closed.map((role) => renderRole(role, true))}</ul> : <p className="section-caption">No closed roles match this search.</p>}</details>}
  </section>;
}
