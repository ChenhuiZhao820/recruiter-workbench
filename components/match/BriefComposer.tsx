"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { MAX_BRIEF_CHARS } from "@/lib/match-core.mjs";
import type { RoleOption } from "./InstantMatch";

// The brief lives in this tab only: kept so "Edit brief" brings it back, never
// saved by Capture, and sent once, to be read into criteria.
const BRIEF_KEY = "capture.instantMatch.brief";
const STAGES = ["Reading the brief", "Picking out the must-haves", "Noting salary, notice and location", "Almost there"];

function storedBrief() {
  try {
    return sessionStorage.getItem(BRIEF_KEY) ?? "";
  } catch {
    return "";
  }
}

export function BriefComposer({
  readOnly,
  readsLeft,
  roles,
  startRole,
  canCancel,
  onCancel,
  onRead,
}: {
  readOnly: boolean;
  readsLeft: number;
  roles: RoleOption[];
  startRole: { id: string; title: string; jobDesc: string } | null;
  canCancel: boolean;
  onCancel: () => void;
  onRead: (encoded: string) => void;
}) {
  const [brief, setBrief] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const fromRole = startRole?.jobDesc.trim() ? `${startRole.title}\n\n${startRole.jobDesc.trim()}` : "";
    const stored = storedBrief();
    setBrief(fromRole && !stored.startsWith(startRole!.title) ? fromRole : stored || fromRole);
    box.current?.focus();
  }, [startRole]);

  useEffect(() => {
    if (!loading) return;
    setStage(0);
    const timer = setInterval(() => setStage((n) => Math.min(n + 1, STAGES.length - 1)), 1300);
    return () => clearInterval(timer);
  }, [loading]);

  const length = brief.trim().length;
  const tooLong = brief.length > MAX_BRIEF_CHARS;
  const blocked = readOnly || readsLeft <= 0;
  const disabled = loading || blocked || length < 20 || tooLong;

  async function read() {
    if (disabled) return;
    setLoading(true);
    setError(null);
    try {
      sessionStorage.setItem(BRIEF_KEY, brief);
    } catch {}
    try {
      const response = await fetch("/api/match/criteria", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.criteria !== "string") {
        setError(body.error ?? "Something went wrong. Try again.");
        setLoading(false);
        return;
      }
      onRead(body.criteria);
    } catch {
      setError("Capture could not be reached. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <section className="im-composer" aria-label="Brief" aria-busy={loading}>
      {!canCancel && (
        <ol className="im-steps" aria-label="How it works">
          <li><span className="section-number">01</span>Paste the brief</li>
          <li><span className="section-number">02</span>Check what Capture understood</li>
          <li><span className="section-number">03</span>Add the right people to the role</li>
        </ol>
      )}
      <div className={`im-composer-box ${loading ? "is-loading" : ""}`}>
        <label id="brief-label" htmlFor="im-brief" className="im-composer-label">
          The job description, and anything the client told you
        </label>
        <textarea
          id="im-brief"
          ref={box}
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void read();
            }
          }}
          disabled={loading || readOnly}
          rows={9}
          spellCheck
          placeholder={"Senior Data Engineer, Manchester, hybrid two days a week.\nMust have Python, dbt and Snowflake. Airflow is a plus.\nBudget up to £90k. Client can't sponsor visas. Needs to start within 8 weeks."}
          aria-describedby="brief-help"
        />
        {loading && (
          <div className="im-reading" role="status">
            <span className="im-reading-bar" aria-hidden="true" />
            <span>{STAGES[stage]}…</span>
          </div>
        )}
        <div className="im-composer-foot">
          <div className="im-composer-meta">
            {roles.some((role) => role.hasJobDesc) && !loading && (
              <label className="im-role-start">
                <span className="sr-only">Start from a role</span>
                <select
                  value={startRole?.id ?? ""}
                  onChange={(event) => {
                    if (event.target.value) window.location.assign(`/people/match?role=${encodeURIComponent(event.target.value)}`);
                  }}
                >
                  <option value="">Start from a role…</option>
                  {roles.filter((role) => role.hasJobDesc).map((role) => (
                    <option key={role.id} value={role.id}>{role.title}{role.client ? ` · ${role.client}` : ""}</option>
                  ))}
                </select>
              </label>
            )}
            <span className={`tabular ${tooLong ? "text-rose-700" : ""}`}>
              {brief.length.toLocaleString("en-GB")} / {MAX_BRIEF_CHARS.toLocaleString("en-GB")}
            </span>
          </div>
          <div className="im-composer-actions">
            {canCancel && !loading && <button type="button" className="btn-quiet" onClick={onCancel}>Keep current criteria</button>}
            <span className="im-kbd" aria-hidden="true">Ctrl ↵</span>
            <button type="button" className="btn-primary" onClick={read} disabled={disabled}>
              {loading ? <><span className="im-spinner" aria-hidden="true" />Reading</> : <><Icon name="spark" size={16} />Find matches</>}
            </button>
          </div>
        </div>
      </div>
      {error && <p role="alert" className="im-error">{error}</p>}
      <p id="brief-help" className="im-fineprint">
        {readOnly
          ? "This is a read-only view. Briefs are read only in your own workspace."
          : readsLeft <= 0
            ? <>You have used this month’s briefs. You can still edit criteria by hand, or use the filters on <Link href="/people">People</Link>.</>
            : <>Only this text is sent to the AI to be read. The people in your database never leave Capture, and the brief is not saved. {readsLeft} {readsLeft === 1 ? "brief" : "briefs"} left this month.</>}
      </p>
    </section>
  );
}
