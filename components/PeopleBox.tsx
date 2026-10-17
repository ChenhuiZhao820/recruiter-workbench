"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { PeopleSearchBox } from "@/components/PeopleSearchBox";
import { Popover } from "@/components/match/Popover";
import { MAX_BRIEF_CHARS } from "@/lib/match-core.mjs";
import { parseMoney } from "@/lib/talent.mjs";

// The one box at the top of People. Match (Pro, the default) reads a job
// description into criteria and finds who fits; Search finds people by name,
// skill or a confirmed detail as you type and never calls a model. A paste
// that reads like a description moves Search to Match on its own; the model
// is still called only when the recruiter presses Enter or the arrow.

export type PeopleFilters = { maxSalary: number | null; maxNotice: number | null; remote: string | null; rightToWork: string | null; freshMonths: number | null };
type Mode = "match" | "search";
type RoleStart = { id: string; title: string; client: string | null };

// The brief lives in this tab only: kept so the box still shows the brief
// behind the match on screen, never saved by Capture.
const BRIEF_KEY = "capture.instantMatch.brief";
const STAGES = ["Reading the brief", "Picking out the must-haves", "Noting salary, notice and location", "Checking your people"];
const REMOTE: Record<string, string> = { onsite: "On site", hybrid: "Hybrid", remote: "Remote", flexible: "Flexible" };
const RTW: Record<string, string> = { has_right: "Has the right to work", needs_sponsorship: "Needs sponsorship", unknown: "Would not say" };
const FRESH = [3, 6, 12];

function storedBrief() {
  try {
    return sessionStorage.getItem(BRIEF_KEY) ?? "";
  } catch {
    return "";
  }
}

function moneyText(amount: number) {
  return amount % 1000 === 0 ? `£${amount / 1000}k` : `£${amount.toLocaleString("en-GB")}`;
}

export function PeopleBox({
  canMatch,
  canFilter,
  readOnly,
  readsLeft,
  initialMode,
  query,
  filters,
  roles,
  startRole,
  hasMatch,
  searchLabel,
  searchPlaceholder,
}: {
  canMatch: boolean;
  canFilter: boolean;
  readOnly: boolean;
  readsLeft: number;
  initialMode: Mode;
  query: string;
  filters: PeopleFilters;
  roles: RoleStart[];
  startRole: { id: string; title: string; jobDesc: string } | null;
  hasMatch: boolean;
  searchLabel: string;
  searchPlaceholder: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(canMatch ? initialMode : "search");
  const [brief, setBrief] = useState("");
  const [searchText, setSearchText] = useState(query);
  const [switched, setSwitched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [navigating, startTransition] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (startRole?.jobDesc.trim()) setBrief(`${startRole.title}\n\n${startRole.jobDesc.trim()}`);
    else if (hasMatch) setBrief(storedBrief());
    if (startRole && canMatch) setMode("match");
  }, [startRole, hasMatch, canMatch]);

  // The box grows with what is in it, up to about ten lines.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 260)}px`;
  }, [brief, mode]);

  useEffect(() => {
    if (!loading) return;
    setStage(0);
    const timer = setInterval(() => setStage((n) => Math.min(n + 1, STAGES.length - 1)), 1300);
    return () => clearInterval(timer);
  }, [loading]);

  const busy = loading || navigating;
  const matchBlocked = readOnly || readsLeft <= 0;
  const tooLong = brief.length > MAX_BRIEF_CHARS;
  const canRead = !busy && !matchBlocked && brief.trim().length >= 20 && !tooLong;

  function switchTo(next: Mode) {
    setSwitched(false);
    setError(null);
    if (next === "match" && !brief.trim() && searchText.trim()) setBrief(searchText.trim());
    if (next === "search" && !searchText.trim() && brief.trim() && !brief.includes("\n") && brief.length <= 150) setSearchText(brief.trim());
    setMode(next);
    setTimeout(() => (next === "match" ? box.current : form.current?.querySelector<HTMLInputElement>("#people-search"))?.focus(), 0);
  }

  async function read() {
    if (!canRead) {
      if (brief.trim().length < 20 && !matchBlocked) setError("Paste the job description, or a few lines about who you need.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      sessionStorage.setItem(BRIEF_KEY, brief);
    } catch {}
    try {
      const response = await fetch("/api/match/criteria", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief }) });
      const body = await response.json().catch(() => ({}));
      setLoading(false);
      if (!response.ok || typeof body.criteria !== "string") {
        setError(body.error ?? "Something went wrong. Try again.");
        return;
      }
      startTransition(() => router.push(`/people?c=${body.criteria}`, { scroll: false }));
    } catch {
      setLoading(false);
      setError("Capture could not be reached. Check your connection and try again.");
    }
  }

  function applyFilters(next: Partial<Record<"salary" | "notice" | "remote" | "rtw" | "fresh", string>>) {
    const current: Record<string, string> = {
      salary: filters.maxSalary !== null ? String(filters.maxSalary) : "",
      notice: filters.maxNotice !== null ? String(filters.maxNotice) : "",
      remote: filters.remote ?? "",
      rtw: filters.rightToWork ?? "",
      fresh: filters.freshMonths !== null ? String(filters.freshMonths) : "",
    };
    const params = new URLSearchParams();
    const typed = (form.current?.querySelector<HTMLInputElement>("#people-search")?.value ?? searchText).trim();
    if (typed) params.set("q", typed);
    for (const [key, value] of Object.entries({ ...current, ...next })) if (value) params.set(key, value);
    startTransition(() => router.push(params.size ? `/people?${params.toString()}` : "/people", { scroll: false }));
  }

  const anyFilter = filters.maxSalary !== null || filters.maxNotice !== null || Boolean(filters.remote) || Boolean(filters.rightToWork) || filters.freshMonths !== null;

  return (
    <section className={`people-box ${busy ? "is-busy" : ""}`} aria-label="Find people">
      <form
        ref={form}
        method="get"
        action="/people"
        role="search"
        className="people-box-card"
        onSubmit={(event) => {
          if (mode === "match") {
            event.preventDefault();
            void read();
          }
        }}
      >
        {mode === "match" ? (
          <>
            <label htmlFor="people-brief" className="sr-only">Paste a job description, or describe who you need</label>
            <textarea
              id="people-brief"
              ref={box}
              value={brief}
              rows={2}
              disabled={loading || readOnly}
              spellCheck
              placeholder={readOnly ? "Matching a brief works in your own workspace. Switch to Search to find people here." : "Paste a job description, or describe who you need: “senior data engineer in Manchester, Python and dbt, up to £90k”"}
              onChange={(event) => { setBrief(event.target.value); setError(null); }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void read();
                }
              }}
              aria-describedby="people-box-help"
            />
          </>
        ) : (
          <>
            <PeopleSearchBox
              key={`${query}`}
              defaultValue={searchText}
              label={searchLabel}
              placeholder={searchPlaceholder}
              onLongPaste={canMatch ? (text) => {
                setBrief(text);
                setMode("match");
                setSwitched(true);
                setTimeout(() => box.current?.focus(), 0);
              } : undefined}
            />
            {filters.maxSalary !== null && <input type="hidden" name="salary" value={filters.maxSalary} />}
            {filters.maxNotice !== null && <input type="hidden" name="notice" value={filters.maxNotice} />}
            {filters.remote && <input type="hidden" name="remote" value={filters.remote} />}
            {filters.rightToWork && <input type="hidden" name="rtw" value={filters.rightToWork} />}
            {filters.freshMonths !== null && <input type="hidden" name="fresh" value={filters.freshMonths} />}
          </>
        )}
        {loading && (
          <div className="im-reading" role="status">
            <span className="im-reading-bar" aria-hidden="true" />
            <span>{STAGES[stage]}…</span>
          </div>
        )}
        <div className="people-box-foot">
          {canMatch ? (
            <Popover
              name="Choose how to find people"
              align="start"
              className="people-mode"
              label={<><Icon name={mode === "match" ? "spark" : "search"} size={15} />{mode === "match" ? "Match" : "Search"}<Icon name="down" size={12} /></>}
            >
              {(close) => (
                <div className="im-menu" role="menu">
                  <button type="button" role="menuitemradio" aria-checked={mode === "match"} className="im-menu-item people-mode-item" onClick={() => { close(); switchTo("match"); }}>
                    <span className="people-mode-name"><Icon name="spark" size={14} />Match{mode === "match" && <Icon name="check" size={13} />}</span>
                    <span className="im-menu-sub">Paste a job description; Capture reads it and finds who fits.{readOnly ? " Your own workspace only." : ` ${readsLeft} left this month.`}</span>
                  </button>
                  <button type="button" role="menuitemradio" aria-checked={mode === "search"} className="im-menu-item people-mode-item" onClick={() => { close(); switchTo("search"); }}>
                    <span className="people-mode-name"><Icon name="search" size={14} />Search{mode === "search" && <Icon name="check" size={13} />}</span>
                    <span className="im-menu-sub">Names, skills, places and confirmed details, as you type. Free.</span>
                  </button>
                </div>
              )}
            </Popover>
          ) : <span />}
          <div className="people-box-actions">
            {mode === "match" && <span className={`people-box-count tabular ${tooLong ? "text-rose-700" : ""}`}>{brief.length > 0 ? `${brief.length.toLocaleString("en-GB")} / ${MAX_BRIEF_CHARS.toLocaleString("en-GB")}` : ""}</span>}
            {mode === "match" && <span className="im-kbd" aria-hidden="true">Enter ↵</span>}
            <button
              type="submit"
              className="people-box-send"
              aria-label={mode === "match" ? "Find matches" : "Run search"}
              title={mode === "match" ? "Find matches (Enter)" : "Search (Enter)"}
              disabled={mode === "match" ? !canRead : busy}
            >
              {loading ? <span className="im-spinner" aria-hidden="true" /> : <Icon name="arrow" size={17} />}
            </button>
          </div>
        </div>
      </form>

      {switched && (
        <p className="people-box-note" role="status">
          That looks like a job description, so the box switched to Match. Press Enter to find who fits, or{" "}
          <button type="button" className="im-link" onClick={() => { setSearchText(""); switchTo("search"); }}>search instead</button>.
        </p>
      )}
      {error && <p role="alert" className="im-error">{error}</p>}

      {mode === "match" && !hasMatch && roles.length > 0 && !readOnly && (
        <div className="people-chips" role="group" aria-label="Match from a role">
          {roles.slice(0, 3).map((role) => (
            <button key={role.id} type="button" className="people-chip" onClick={() => startTransition(() => router.push(`/people?role=${encodeURIComponent(role.id)}`, { scroll: false }))}>
              <Icon name="roles" size={13} />Match {role.title}
            </button>
          ))}
          {roles.length > 3 && (
            <Popover name="Match from another role" align="start" className="people-chip" label={<>More roles<Icon name="down" size={12} /></>}>
              {(close) => (
                <div className="im-menu">
                  {roles.slice(3).map((role) => (
                    <button key={role.id} type="button" className="im-menu-item" onClick={() => { close(); startTransition(() => router.push(`/people?role=${encodeURIComponent(role.id)}`, { scroll: false })); }}>
                      {role.title}{role.client ? <span className="im-menu-sub">{role.client}</span> : null}
                    </button>
                  ))}
                </div>
              )}
            </Popover>
          )}
        </div>
      )}

      {mode === "search" && canFilter && (
        <div className="people-chips" role="group" aria-label="Filters">
          <FilterChip name="Salary" label={filters.maxSalary !== null ? `Salary up to ${moneyText(filters.maxSalary)}` : "Salary"} set={filters.maxSalary !== null} onClear={() => applyFilters({ salary: "" })}>
            {(close) => (
              <NumberFilter label="Salary up to (a year)" placeholder="e.g. 90k" initial={filters.maxSalary !== null ? String(filters.maxSalary) : ""} read={(text) => parseMoney(text)} problem="Type a yearly figure, such as 90k." onApply={(value) => { close(); applyFilters({ salary: value === null ? "" : String(value) }); }} onCancel={close} />
            )}
          </FilterChip>
          <FilterChip name="Notice" label={filters.maxNotice !== null ? `Notice up to ${filters.maxNotice} ${filters.maxNotice === 1 ? "week" : "weeks"}` : "Notice"} set={filters.maxNotice !== null} onClear={() => applyFilters({ notice: "" })}>
            {(close) => (
              <NumberFilter label="Notice up to (weeks)" placeholder="e.g. 4" initial={filters.maxNotice !== null ? String(filters.maxNotice) : ""} read={(text) => { const n = Number(text); return text.trim() && Number.isInteger(n) && n >= 0 && n <= 104 ? n : null; }} problem="Type a whole number of weeks." onApply={(value) => { close(); applyFilters({ notice: value === null ? "" : String(value) }); }} onCancel={close} />
            )}
          </FilterChip>
          <FilterChip name="Working pattern" label={filters.remote ? REMOTE[filters.remote] : "Working pattern"} set={Boolean(filters.remote)} onClear={() => applyFilters({ remote: "" })}>
            {(close) => <ChoiceFilter options={Object.entries(REMOTE)} value={filters.remote} onPick={(value) => { close(); applyFilters({ remote: value }); }} />}
          </FilterChip>
          <FilterChip name="Right to work" label={filters.rightToWork ? RTW[filters.rightToWork] : "Right to work"} set={Boolean(filters.rightToWork)} onClear={() => applyFilters({ rtw: "" })}>
            {(close) => <ChoiceFilter options={Object.entries(RTW)} value={filters.rightToWork} onPick={(value) => { close(); applyFilters({ rtw: value }); }} />}
          </FilterChip>
          <FilterChip name="Confirmed within" label={filters.freshMonths !== null ? `Confirmed within ${filters.freshMonths} months` : "Confirmed within"} set={filters.freshMonths !== null} onClear={() => applyFilters({ fresh: "" })}>
            {(close) => <ChoiceFilter options={FRESH.map((months) => [String(months), `${months} months`])} value={filters.freshMonths !== null ? String(filters.freshMonths) : null} onPick={(value) => { close(); applyFilters({ fresh: value }); }} />}
          </FilterChip>
          {anyFilter && <button type="button" className="people-chip is-clear" onClick={() => applyFilters({ salary: "", notice: "", remote: "", rtw: "", fresh: "" })}>Clear filters</button>}
          <span className="people-chips-note">Filters use facts confirmed on a call; someone with nothing confirmed for a filter is left out of it.</span>
        </div>
      )}

      <p id="people-box-help" className="im-fineprint" hidden={hasMatch}>
        {mode === "match"
          ? readOnly
            ? "This is a read-only view. Briefs are read only in your own workspace."
            : readsLeft <= 0
              ? "You have used this month’s briefs. Switch to Search, or edit the criteria of a match by hand."
              : <>Only what you type here is sent to the AI to be read. The people in your database never leave Capture, and the brief is not saved. {readsLeft} {readsLeft === 1 ? "brief" : "briefs"} left this month.</>
          : null}
      </p>
    </section>
  );
}

// A filter as a chip under the box: its value when set, a small editor on a
// click, and a cross to clear it without opening anything.
function FilterChip({ name, label, set, onClear, children }: {
  name: string;
  label: string;
  set: boolean;
  onClear: () => void;
  children: (close: () => void) => React.ReactNode;
}) {
  return (
    <span className={`people-chip-wrap ${set ? "is-set" : ""}`}>
      <Popover name={`Filter by ${name.toLowerCase()}`} align="start" className={`people-chip ${set ? "is-set" : ""}`} label={<>{label}{!set && <Icon name="down" size={12} />}</>}>
        {children}
      </Popover>
      {set && (
        <button type="button" className="people-chip-clear" aria-label={`Clear ${name.toLowerCase()}`} onClick={onClear}>
          <Icon name="close" size={12} />
        </button>
      )}
    </span>
  );
}

function NumberFilter({ label, placeholder, initial, read, problem, onApply, onCancel }: {
  label: string;
  placeholder: string;
  initial: string;
  read: (text: string) => number | null;
  problem: string;
  onApply: (value: number | null) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="im-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return onApply(null);
        const value = read(text);
        if (value === null) return setError(problem);
        onApply(value);
      }}
    >
      <label>
        <span className="field-label">{label}</span>
        <input className="field-input tabular" inputMode="numeric" value={text} placeholder={placeholder} onChange={(event) => setText(event.target.value)} />
      </label>
      {error && <p role="alert" className="im-error">{error}</p>}
      <div className="im-editor-actions">
        <button type="button" className="btn-quiet" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary im-btn-small">Apply</button>
      </div>
    </form>
  );
}

function ChoiceFilter({ options, value, onPick }: { options: [string, string][]; value: string | null; onPick: (value: string) => void }) {
  return (
    <div className="im-menu" role="menu">
      {options.map(([key, text]) => (
        <button key={key} type="button" role="menuitemradio" aria-checked={value === key} className="im-menu-item people-mode-item" onClick={() => onPick(key)}>
          <span className="people-mode-name">{text}{value === key && <Icon name="check" size={13} />}</span>
        </button>
      ))}
      {value && <button type="button" role="menuitem" className="im-menu-item" onClick={() => onPick("")}>Any</button>}
    </div>
  );
}
