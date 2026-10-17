"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { encodeCriteria } from "@/lib/match-core.mjs";
import { BriefComposer } from "./BriefComposer";
import { CriteriaPanel } from "./CriteriaPanel";
import { MatchResults } from "./MatchResults";
import { Handoff } from "./Handoff";

export type Skill = { name: string; also: string[] };
export type Criteria = {
  title: string;
  titles: string[];
  must: Skill[];
  nice: Skill[];
  senMin: number | null;
  senMax: number | null;
  salaryMax: number | null;
  currency: string | null;
  noticeMax: number | null;
  location: Skill | null;
  pattern: string | null;
  rtw: boolean;
  unknownOk: Record<string, boolean>;
  unchecked: string[];
};

export type MatchRowData = {
  id: string;
  fullName: string;
  headline: string | null;
  facts: string[];
  stale: boolean;
  hits: { must: string[]; nice: string[]; titles: string[] };
  roles: { id: string; title: string }[];
  miss: { why: string; status: string } | null;
  notFit: { reason: string; label: string; href: string }[];
};

export type RoleOption = {
  id: string;
  title: string;
  client: string | null;
  hasJobDesc: boolean;
  budgetText: string | null;
  skills: string[];
  titles: string[];
};

export type MatchPageData = {
  readOnly: boolean;
  readsLeft: number;
  criteria: Criteria | null;
  encoded: string | null;
  hidden: string[];
  requirements: { key: string; text: string; unknownOk: boolean }[];
  query: string;
  results: {
    total: number;
    matches: MatchRowData[];
    near: MatchRowData[];
    nearTotal: number;
    loosen: { id: string; label: string; gain: number; href: string }[];
    loosenDepth: number;
    hiddenCount: number;
    showAllHref: string | null;
    unhideHref: string | null;
    databaseSize: number;
  } | null;
  roles: RoleOption[];
  startRole: { id: string; title: string; jobDesc: string } | null;
};

export type Toast = { id: number; lines: string[]; delta: number | null; undo: boolean };
type PendingToast = { lines: string[]; undo: boolean; before: number };

export function matchHref(encoded: string, hidden: string[] = []) {
  const params = new URLSearchParams({ c: encoded });
  if (hidden.length) params.set("x", hidden.join(","));
  return `/people/match?${params.toString()}`;
}

// Counts only, and only of the ways out of a disappointing match. Never waits
// and never fails the click it rides on.
export function recordMatchEvent(kind: "match_loosened" | "match_not_fit" | "match_handoff", reason?: string) {
  fetch("/api/match/event", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, reason }), keepalive: true }).catch(() => {});
}

export function InstantMatch({ data }: { data: MatchPageData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingBrief, setEditingBrief] = useState(!data.criteria);
  const [toast, setToast] = useState<Toast | null>(null);
  const pendingToast = useRef<PendingToast | null>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);

  // Every change is a new address, so the browser's Back is the undo.
  const go = useCallback((url: string, lines: string[] = [], undo = true) => {
    pendingToast.current = lines.length ? { lines, undo, before: data.results?.total ?? 0 } : null;
    setToast(null);
    startTransition(() => router.push(url, { scroll: false }));
  }, [router, data.results?.total]);

  const change = useCallback((next: Criteria, lines: string[]) => {
    go(matchHref(encodeCriteria(next), data.hidden), lines);
  }, [go, data.hidden]);

  const hiddenKey = data.hidden.join(",");
  useEffect(() => {
    const waiting = pendingToast.current;
    if (!waiting) return;
    pendingToast.current = null;
    const after = data.results?.total ?? 0;
    setToast({ id: Date.now(), lines: waiting.lines, delta: after - waiting.before, undo: waiting.undo });
  }, [data.encoded, hiddenKey, data.results?.total]);

  useEffect(() => {
    if (!data.criteria) setEditingBrief(true);
  }, [data.criteria]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  const showComposer = editingBrief || !data.criteria;

  return (
    <div className="im-page">
      {showComposer && (
        <BriefComposer
          key={data.startRole?.id ?? "brief"}
          readOnly={data.readOnly}
          readsLeft={data.readsLeft}
          roles={data.roles}
          startRole={data.startRole}
          canCancel={Boolean(data.criteria)}
          onCancel={() => setEditingBrief(false)}
          onRead={(encoded) => {
            setEditingBrief(false);
            go(matchHref(encoded), []);
            setTimeout(() => resultsHeading.current?.focus(), 600);
          }}
        />
      )}

      {data.criteria && data.encoded && (
        <>
          <CriteriaPanel
            criteria={data.criteria}
            encoded={data.encoded}
            requirements={data.requirements}
            roles={data.roles}
            defaultRoleId={data.startRole?.id ?? null}
            readOnly={data.readOnly}
            readsLeft={data.readsLeft}
            briefOpen={showComposer}
            onEditBrief={() => setEditingBrief(true)}
            onChange={change}
            onAdjusted={(encoded, lines) => go(matchHref(encoded, data.hidden), lines.length ? lines : ["Nothing needed changing"], lines.length > 0)}
          />
          {data.results && (
            <MatchResults
              results={data.results}
              roles={data.roles}
              defaultRoleId={data.startRole?.id ?? null}
              readOnly={data.readOnly}
              pending={pending}
              headingRef={resultsHeading}
              go={go}
            />
          )}
          <Handoff
            criteria={data.criteria}
            encoded={data.encoded}
            query={data.query}
            roles={data.roles}
            defaultRoleId={data.startRole?.id ?? null}
            readOnly={data.readOnly}
            prominent={(data.results?.total ?? 0) < 5}
          />
        </>
      )}

      <div className="im-toast-region" aria-live="polite">
        {toast && (
          <div key={toast.id} className="im-toast" role="status">
            <div className="min-w-0">
              {toast.delta !== null && toast.delta !== 0 && (
                <p className="im-toast-delta tabular">
                  {toast.delta > 0 ? `+${toast.delta}` : toast.delta} {Math.abs(toast.delta) === 1 ? "match" : "matches"}
                </p>
              )}
              <p className="im-toast-text">{toast.lines.slice(0, 3).join(" · ")}{toast.lines.length > 3 ? ` · and ${toast.lines.length - 3} more` : ""}</p>
            </div>
            {toast.undo && (
              <button type="button" className="im-toast-undo" onClick={() => { setToast(null); router.back(); }}>
                <Icon name="undo" size={15} />Undo
              </button>
            )}
            <button type="button" className="im-toast-close" aria-label="Dismiss" onClick={() => setToast(null)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
