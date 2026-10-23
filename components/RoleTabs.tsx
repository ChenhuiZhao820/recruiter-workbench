"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ROLE_TABS, type RoleTab } from "@/lib/role-tabs";

// A role page shows one of its three parts at a time, chosen from a row of
// plain words with a line under the one on screen. Every part stays rendered,
// only hidden, so a half-typed form survives a look at another tab. The choice
// is kept in the address (?tab=) without a reload, and an address that points
// inside a part (#candidate-…) opens that part.
export function RoleTabs({ initial, tabs }: { initial: RoleTab; tabs: { id: RoleTab; label: string; count?: number; panel: ReactNode }[] }) {
  const [active, setActive] = useState<RoleTab>(initial);
  const list = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLSpanElement>(null);

  const choose = useCallback((tab: RoleTab, focus = false) => {
    setActive(tab);
    const url = new URL(window.location.href);
    if (tab === "candidates") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    url.hash = "";
    window.history.replaceState(window.history.state, "", url);
    if (focus) list.current?.querySelector<HTMLButtonElement>(`#role-tab-${tab}`)?.focus();
  }, []);

  // The line slides to the tab on screen, and follows it when text reflows.
  useLayoutEffect(() => {
    const place = () => {
      const tab = list.current?.querySelector<HTMLElement>(`#role-tab-${active}`);
      if (!tab || !line.current) return;
      line.current.style.width = `${tab.offsetWidth}px`;
      line.current.style.transform = `translateX(${tab.offsetLeft}px)`;
    };
    place();
    window.addEventListener("resize", place);
    document.fonts?.ready.then(place).catch(() => {});
    return () => window.removeEventListener("resize", place);
  }, [active]);

  // An anchor inside a hidden part opens that part first, then scrolls to it.
  useEffect(() => {
    const follow = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const target = id ? document.getElementById(id) : null;
      const panel = target?.closest<HTMLElement>("[data-role-tab]");
      const tab = panel?.dataset.roleTab as RoleTab | undefined;
      if (!target || !tab) return;
      setActive(tab);
      requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    const at = ROLE_TABS.indexOf(active);
    const next = event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? ROLE_TABS.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    choose(ROLE_TABS[(next + ROLE_TABS.length) % ROLE_TABS.length], true);
  }

  return (
    <div className="role-tabs">
      <div ref={list} role="tablist" aria-label="Role" className="role-tablist" onKeyDown={keys}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`role-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            aria-controls={`role-panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            className="role-tab"
            onClick={() => choose(tab.id)}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && <span className="role-tab-count tabular">{tab.count}</span>}
          </button>
        ))}
        <span ref={line} aria-hidden="true" className="role-tab-line" />
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`role-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`role-tab-${tab.id}`}
          data-role-tab={tab.id}
          hidden={active !== tab.id}
          className="role-panel"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
