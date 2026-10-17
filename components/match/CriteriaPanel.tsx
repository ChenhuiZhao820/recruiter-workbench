"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { saveCriteriaToBriefing } from "@/app/actions/match";
import { MAX_INSTRUCTION_CHARS, SENIORITY_LABELS, money, normalise } from "@/lib/match-core.mjs";
import { parseMoney } from "@/lib/talent.mjs";
import { Popover } from "./Popover";
import type { Criteria, RoleOption, Skill } from "./InstantMatch";

type Change = (next: Criteria, lines: string[]) => void;
type ReqKey = "salary" | "notice" | "pattern" | "location" | "rtw" | "seniority";

const REQUIREMENT_NAMES: Record<ReqKey, string> = {
  salary: "Salary limit",
  notice: "Notice period",
  pattern: "Working pattern",
  location: "Location",
  rtw: "Right to work",
  seniority: "Seniority",
};

export function CriteriaPanel({
  criteria,
  encoded,
  requirements,
  roles,
  defaultRoleId,
  readOnly,
  readsLeft,
  briefOpen,
  onEditBrief,
  onChange,
  onAdjusted,
}: {
  criteria: Criteria;
  encoded: string;
  requirements: { key: string; text: string; unknownOk: boolean }[];
  roles: RoleOption[];
  defaultRoleId: string | null;
  readOnly: boolean;
  readsLeft: number;
  briefOpen: boolean;
  onEditBrief: () => void;
  onChange: Change;
  onAdjusted: (encoded: string, lines: string[]) => void;
}) {
  const set = (patch: Partial<Criteria>, line: string) => onChange({ ...criteria, ...patch }, [line]);
  const missing = (Object.keys(REQUIREMENT_NAMES) as ReqKey[]).filter((key) => !requirements.some((item) => item.key === key));

  return (
    <section className="im-criteria" aria-labelledby="criteria-heading">
      <header className="im-criteria-head">
        <div className="min-w-0">
          <p className="page-eyebrow">What Capture is looking for</p>
          <h2 id="criteria-heading" className="im-criteria-title">{criteria.title || "Your brief"}</h2>
          <p className="im-criteria-hint">Click a skill to move it between must-have and nice-to-have. Every change re-runs the match.</p>
        </div>
        <div className="im-criteria-actions">
          {!briefOpen && (
            <button type="button" className="btn-quiet" onClick={onEditBrief}>
              <Icon name="file" size={14} />Edit brief
            </button>
          )}
          <SaveToBriefing criteria={criteria} encoded={encoded} roles={roles} defaultRoleId={defaultRoleId} readOnly={readOnly} />
        </div>
      </header>

      <div className="im-criteria-grid">
        <SkillGroup
          label="Must have"
          kind="must"
          skills={criteria.must}
          empty="Nothing required. Add a skill everyone must have."
          onMove={(skill) => set({ must: criteria.must.filter((item) => item !== skill), nice: [skill, ...criteria.nice] }, `${skill.name} is now a nice-to-have`)}
          onRemove={(skill) => set({ must: criteria.must.filter((item) => item !== skill) }, `Removed ${skill.name}`)}
          onAdd={(name) => set({ must: [...criteria.must, { name, also: [] }], nice: criteria.nice.filter((item) => normalise(item.name) !== normalise(name)) }, `Added must-have: ${name}`)}
        />
        <SkillGroup
          label="Nice to have"
          kind="nice"
          skills={criteria.nice}
          empty="Nothing extra. Nice-to-haves rank people higher without leaving anyone out."
          onMove={(skill) => set({ nice: criteria.nice.filter((item) => item !== skill), must: [...criteria.must, skill] }, `${skill.name} is now a must-have`)}
          onRemove={(skill) => set({ nice: criteria.nice.filter((item) => item !== skill) }, `Removed ${skill.name}`)}
          onAdd={(name) => set({ nice: [...criteria.nice, { name, also: [] }], must: criteria.must.filter((item) => normalise(item.name) !== normalise(name)) }, `Added nice-to-have: ${name}`)}
        />
        <div className="im-group">
          <h3 className="im-group-label">Also goes by</h3>
          <ul className="im-chips">
            {criteria.titles.map((title) => (
              <li key={title} className="im-chip im-chip--title">
                <span className="im-chip-label">{title}</span>
                <button type="button" className="im-chip-x" aria-label={`Remove ${title}`} onClick={() => set({ titles: criteria.titles.filter((item) => item !== title) }, `No longer looking for ${title}`)}>
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
            <li><AddInline label="Add a title" onAdd={(title) => set({ titles: [...criteria.titles, title] }, `Also looking for ${title}`)} /></li>
          </ul>
        </div>
        <div className="im-group">
          <h3 className="im-group-label">Requirements</h3>
          <ul className="im-chips">
            {requirements.map((item) => (
              <li key={item.key}>
                <Popover
                  name={`Edit ${REQUIREMENT_NAMES[item.key as ReqKey].toLowerCase()}`}
                  align="start"
                  className={`im-chip im-chip--req ${item.unknownOk ? "is-lenient" : ""}`}
                  label={<>{item.text}{item.unknownOk && <span className="im-chip-note">+ unconfirmed</span>}<Icon name="down" size={12} /></>}
                >
                  {(close) => <RequirementEditor reqKey={item.key as ReqKey} criteria={criteria} onChange={onChange} close={close} />}
                </Popover>
              </li>
            ))}
            {missing.length > 0 && (
              <li>
                <Popover name="Add a requirement" align="start" className="im-add" label={<><Icon name="plus" size={13} />Requirement</>}>
                  {(close) => <AddRequirement missing={missing} criteria={criteria} onChange={onChange} close={close} />}
                </Popover>
              </li>
            )}
          </ul>
          <p className="im-group-help">Checked against facts confirmed on a call. Unconfirmed facts put someone in &ldquo;one thing off&rdquo; unless you count them.</p>
        </div>
      </div>

      {criteria.unchecked.length > 0 && (
        <p className="im-unchecked">
          <Icon name="eye" size={15} />
          <span><strong>Check these yourself:</strong> {criteria.unchecked.join(" · ")}. Your records cannot answer them, so they are not used to match.</span>
        </p>
      )}

      <AdjustBar encoded={encoded} readOnly={readOnly} readsLeft={readsLeft} onAdjusted={onAdjusted} />
    </section>
  );
}

function SkillGroup({ label, kind, skills, empty, onMove, onRemove, onAdd }: {
  label: string;
  kind: "must" | "nice";
  skills: Skill[];
  empty: string;
  onMove: (skill: Skill) => void;
  onRemove: (skill: Skill) => void;
  onAdd: (name: string) => void;
}) {
  const other = kind === "must" ? "nice-to-have" : "must-have";
  return (
    <div className="im-group">
      <h3 className="im-group-label">{label} <span className="tabular">{skills.length}</span></h3>
      <ul className="im-chips">
        {skills.map((skill) => (
          <li key={skill.name} className={`im-chip im-chip--${kind}`}>
            <button
              type="button"
              className="im-chip-label"
              title={`${skill.also.length ? `Also matches ${skill.also.join(", ")}. ` : ""}Click to make it a ${other}.`}
              aria-label={`${skill.name}: make it a ${other}`}
              onClick={() => onMove(skill)}
            >
              {skill.name}
              {skill.also.length > 0 && <span className="im-chip-also">+{skill.also.length}</span>}
            </button>
            <button type="button" className="im-chip-x" aria-label={`Remove ${skill.name}`} onClick={() => onRemove(skill)}>
              <Icon name="close" size={12} />
            </button>
          </li>
        ))}
        <li><AddInline label={`Add a ${kind === "must" ? "must-have" : "nice-to-have"}`} onAdd={onAdd} /></li>
      </ul>
      {skills.length === 0 && <p className="im-group-help">{empty}</p>}
    </div>
  );
}

function AddInline({ label, onAdd }: { label: string; onAdd: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  if (!open) {
    return (
      <button type="button" className="im-add" aria-label={label} onClick={() => { setOpen(true); setTimeout(() => input.current?.focus(), 0); }}>
        <Icon name="plus" size={13} />Add
      </button>
    );
  }
  const submit = () => {
    const text = value.replace(/\s+/g, " ").trim().slice(0, 60);
    if (text) onAdd(text);
    setValue("");
    setOpen(false);
  };
  return (
    <form className="im-add-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <input
        ref={input}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape") { setValue(""); setOpen(false); } }}
        onBlur={() => { if (!value.trim()) setOpen(false); }}
        aria-label={label}
        placeholder={label}
        maxLength={60}
      />
      <button type="submit" className="im-add-ok" aria-label="Add"><Icon name="check" size={13} /></button>
    </form>
  );
}

function AddRequirement({ missing, criteria, onChange, close }: { missing: ReqKey[]; criteria: Criteria; onChange: Change; close: () => void }) {
  const [chosen, setChosen] = useState<ReqKey | null>(missing.length === 1 ? missing[0] : null);
  if (chosen) return <RequirementEditor reqKey={chosen} criteria={criteria} onChange={onChange} close={close} adding />;
  return (
    <div className="im-menu">
      {missing.map((key) => (
        <button key={key} type="button" className="im-menu-item" onClick={() => setChosen(key)}>{REQUIREMENT_NAMES[key]}</button>
      ))}
    </div>
  );
}

// One requirement, changed or removed. "Count unconfirmed as a fit" is the
// recruiter's call per requirement, because a record without a confirmed fact
// is not a record that fails it.
function RequirementEditor({ reqKey, criteria, onChange, close, adding = false }: {
  reqKey: ReqKey;
  criteria: Criteria;
  onChange: Change;
  close: () => void;
  adding?: boolean;
}) {
  const [salary, setSalary] = useState(criteria.salaryMax !== null ? String(criteria.salaryMax) : "");
  const [currency, setCurrency] = useState(criteria.currency ?? "GBP");
  const [notice, setNotice] = useState(criteria.noticeMax !== null ? String(criteria.noticeMax) : "8");
  const [pattern, setPattern] = useState(criteria.pattern ?? "hybrid");
  const [place, setPlace] = useState(criteria.location?.name ?? "");
  const [senMin, setSenMin] = useState(criteria.senMin ? String(criteria.senMin) : adding ? "3" : "");
  const [senMax, setSenMax] = useState(criteria.senMax ? String(criteria.senMax) : "");
  const [lenient, setLenient] = useState(Boolean(criteria.unknownOk[reqKey]));
  const [problem, setProblem] = useState<string | null>(null);

  const unknownOk = { ...criteria.unknownOk, [reqKey]: lenient };
  if (!lenient) delete unknownOk[reqKey];
  const name = REQUIREMENT_NAMES[reqKey];

  function save() {
    let patch: Partial<Criteria> = {};
    if (reqKey === "salary") {
      const amount = parseMoney(salary);
      if (amount === null) return setProblem("Type a yearly figure, such as 90k or 90000.");
      const code = currency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) return setProblem("Currency is a three-letter code, such as GBP.");
      patch = { salaryMax: amount, currency: code };
    } else if (reqKey === "notice") {
      const weeks = Number(notice);
      if (!Number.isInteger(weeks) || weeks < 0 || weeks > 104) return setProblem("Type a whole number of weeks.");
      patch = { noticeMax: weeks };
    } else if (reqKey === "pattern") {
      patch = { pattern };
    } else if (reqKey === "location") {
      const text = place.replace(/\s+/g, " ").trim().slice(0, 60);
      if (!text) return setProblem("Type a town, city or region.");
      patch = { location: text === criteria.location?.name ? criteria.location : { name: text, also: [] } };
    } else if (reqKey === "rtw") {
      patch = { rtw: true };
    } else if (reqKey === "seniority") {
      const min = senMin ? Number(senMin) : null;
      const max = senMax ? Number(senMax) : null;
      if (!min && !max) return setProblem("Choose a lowest or highest level.");
      if (min && max && min > max) return setProblem("The lowest level is above the highest.");
      patch = { senMin: min, senMax: max };
    }
    close();
    onChange({ ...criteria, ...patch, unknownOk }, [adding ? `Added ${name.toLowerCase()}` : `Changed ${name.toLowerCase()}`]);
  }

  function remove() {
    const patch: Partial<Criteria> = {
      salary: { salaryMax: null },
      notice: { noticeMax: null },
      pattern: { pattern: null },
      location: { location: null },
      rtw: { rtw: false },
      seniority: { senMin: null, senMax: null },
    }[reqKey];
    const rest = { ...criteria.unknownOk };
    delete rest[reqKey];
    close();
    onChange({ ...criteria, ...patch, unknownOk: rest }, [`No ${name.toLowerCase()} requirement`]);
  }

  return (
    <form className="im-editor" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <p className="im-editor-title">{name}</p>
      {reqKey === "salary" && (
        <div className="im-editor-row">
          <label className="min-w-0 flex-1">
            <span className="field-label">Up to, a year</span>
            <input className="field-input tabular" inputMode="numeric" value={salary} onChange={(event) => setSalary(event.target.value)} placeholder="90k" />
          </label>
          <label className="w-20">
            <span className="field-label">Currency</span>
            <input className="field-input uppercase" value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value)} />
          </label>
        </div>
      )}
      {reqKey === "notice" && (
        <label>
          <span className="field-label">Notice up to, in weeks</span>
          <input className="field-input tabular" type="number" min={0} max={104} value={notice} onChange={(event) => setNotice(event.target.value)} />
        </label>
      )}
      {reqKey === "pattern" && (
        <label>
          <span className="field-label">The role is</span>
          <select className="field-input" value={pattern} onChange={(event) => setPattern(event.target.value)}>
            <option value="onsite">On site</option>
            <option value="hybrid">Hybrid</option>
            <option value="remote">Remote</option>
          </select>
        </label>
      )}
      {reqKey === "location" && (
        <label>
          <span className="field-label">Based near</span>
          <input className="field-input" value={place} onChange={(event) => setPlace(event.target.value)} placeholder="Manchester" />
          {criteria.location?.also.length ? <span className="im-editor-note">Also counts {criteria.location.also.join(", ")}</span> : null}
        </label>
      )}
      {reqKey === "rtw" && <p className="im-editor-note">Only people who confirmed they have the right to work, without sponsorship.</p>}
      {reqKey === "seniority" && (
        <div className="im-editor-row">
          <label className="min-w-0 flex-1">
            <span className="field-label">From</span>
            <select className="field-input" value={senMin} onChange={(event) => setSenMin(event.target.value)}>
              <option value="">Any</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{SENIORITY_LABELS[n as 1]}</option>)}
            </select>
          </label>
          <label className="min-w-0 flex-1">
            <span className="field-label">To</span>
            <select className="field-input" value={senMax} onChange={(event) => setSenMax(event.target.value)}>
              <option value="">Any</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{SENIORITY_LABELS[n as 1]}</option>)}
            </select>
          </label>
        </div>
      )}
      {reqKey === "seniority" && <p className="im-editor-note">Read from each headline, such as &ldquo;Senior&rdquo; or &ldquo;Head of&rdquo;.</p>}
      <label className="im-editor-check">
        <input type="checkbox" checked={lenient} onChange={(event) => setLenient(event.target.checked)} />
        <span>Count people with this not confirmed as a fit</span>
      </label>
      {problem && <p role="alert" className="im-error">{problem}</p>}
      <div className="im-editor-actions">
        {!adding && <button type="button" className="im-link-danger" onClick={remove}>Remove</button>}
        <button type="button" className="btn-quiet" onClick={close}>Cancel</button>
        <button type="submit" className="btn-primary im-btn-small">{adding ? "Add" : "Apply"}</button>
      </div>
    </form>
  );
}

// Explicit, never automatic: the criteria join a role's briefing so that role's
// own matches and searches use them. What will change is said before saving.
function SaveToBriefing({ criteria, encoded, roles, defaultRoleId, readOnly }: {
  criteria: Criteria;
  encoded: string;
  roles: RoleOption[];
  defaultRoleId: string | null;
  readOnly: boolean;
}) {
  const [roleId, setRoleId] = useState(defaultRoleId && roles.some((role) => role.id === defaultRoleId) ? defaultRoleId : roles[0]?.id ?? "");
  const role = roles.find((item) => item.id === roleId);
  const have = new Set((role?.skills ?? []).map(normalise));
  const haveTitles = new Set((role?.titles ?? []).map(normalise));
  const newSkills = [...criteria.must, ...criteria.nice].map((skill) => skill.name).filter((name) => !have.has(normalise(name)));
  const newTitles = [criteria.title, ...criteria.titles].filter(Boolean).filter((title) => !haveTitles.has(normalise(title)));
  const budget = criteria.salaryMax !== null ? `up to ${money(criteria.salaryMax, criteria.currency ?? "GBP")}` : null;

  return (
    <Popover name="Save to a role’s briefing" disabled={readOnly} title={readOnly ? "Read-only view" : undefined} label={<><Icon name="roles" size={14} />Save to a role</>}>
      {(close) => roles.length === 0 ? (
        <div className="im-editor">
          <p className="im-editor-title">No open roles</p>
          <p className="im-editor-note">Create the role first, then save these criteria to its briefing.</p>
          <div className="im-editor-actions"><Link href="/roles/new" className="btn-primary im-btn-small">New role</Link></div>
        </div>
      ) : (
        <ActionForm action={saveCriteriaToBriefing} className="im-editor">
          <p className="im-editor-title">Save to a role&rsquo;s briefing</p>
          <input type="hidden" name="criteria" value={encoded} />
          <label>
            <span className="field-label">Role</span>
            <select name="roleId" className="field-input" value={roleId} onChange={(event) => setRoleId(event.target.value)}>
              {roles.map((item) => <option key={item.id} value={item.id}>{item.title}{item.client ? ` · ${item.client}` : ""}</option>)}
            </select>
          </label>
          <div className="im-preview">
            {newSkills.length || newTitles.length ? (
              <>
                {newSkills.length > 0 && <p><strong>Adds {newSkills.length} key {newSkills.length === 1 ? "skill" : "skills"}:</strong> {newSkills.join(", ")}</p>}
                {newTitles.length > 0 && <p><strong>Adds {newTitles.length === 1 ? "a title" : `${newTitles.length} titles`}:</strong> {newTitles.join(", ")}</p>}
              </>
            ) : (
              <p>The briefing already has every skill and title.</p>
            )}
            <p className="im-editor-note">Nothing already in the briefing is removed. The role&rsquo;s &ldquo;From your database&rdquo; list will use these too.</p>
          </div>
          {budget && (
            <label className="im-editor-check">
              <input type="checkbox" name="setBudget" defaultChecked={!role?.budgetText} key={roleId} />
              <span>Set the role&rsquo;s budget to {budget}{role?.budgetText ? ` (now ${role.budgetText})` : ""}</span>
            </label>
          )}
          <div className="im-editor-actions">
            {role && <Link href={`/roles/${role.id}`} className="btn-quiet">Open role</Link>}
            <button type="button" className="btn-quiet" onClick={close}>Close</button>
            <SubmitButton className="btn-primary im-btn-small" pendingLabel="Saving">Save</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Popover>
  );
}

// Changing the criteria in a sentence. The sentence and the current criteria
// go to the model; no person does. The result is shown as a list of changes,
// and Back undoes it like any other.
function AdjustBar({ encoded, readOnly, readsLeft, onAdjusted }: {
  encoded: string;
  readOnly: boolean;
  readsLeft: number;
  onAdjusted: (encoded: string, lines: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = readOnly || readsLeft <= 0;

  async function submit() {
    const instruction = text.trim();
    if (!instruction || busy || blocked) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/match/criteria", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ criteria: encoded, instruction }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.criteria !== "string") {
        setError(body.error ?? "Something went wrong. Try again.");
      } else {
        setText("");
        onAdjusted(body.criteria, Array.isArray(body.changes) ? body.changes : []);
      }
    } catch {
      setError("Capture could not be reached. Check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <div className="im-adjust">
      <form className={`im-adjust-box ${busy ? "is-busy" : ""}`} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <Icon name="spark" size={16} className="im-adjust-icon" />
        <label htmlFor="im-adjust" className="sr-only">Adjust the criteria in your own words</label>
        <input
          id="im-adjust"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={MAX_INSTRUCTION_CHARS}
          disabled={busy || blocked}
          placeholder={blocked ? (readOnly ? "Adjusting in words works in your own workspace" : "No briefs left this month: edit the criteria above") : "Adjust in your own words: “must have led a team”, “they can’t sponsor”, “drop Kafka”"}
          autoComplete="off"
        />
        <button type="submit" className="btn-secondary im-btn-small" disabled={busy || blocked || !text.trim()}>
          {busy ? <><span className="im-spinner is-dark" aria-hidden="true" />Adjusting</> : "Adjust"}
        </button>
      </form>
      {error && <p role="alert" className="im-error">{error}</p>}
    </div>
  );
}
