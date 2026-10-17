"use client";

import Link from "next/link";
import type { RefObject } from "react";
import { Icon } from "@/components/Icon";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { addPersonToRole } from "@/app/actions/talent";
import { FEW_MATCHES } from "@/lib/match-core.mjs";
import { Popover } from "./Popover";
import { recordMatchEvent, type MatchPageData, type MatchRowData, type RoleOption } from "./InstantMatch";

type Results = NonNullable<MatchPageData["results"]>;
type Go = (url: string, lines?: string[], undo?: boolean) => void;

export function MatchResults({ results, roles, defaultRoleId, readOnly, pending, headingRef, go }: {
  results: Results;
  roles: RoleOption[];
  defaultRoleId: string | null;
  readOnly: boolean;
  pending: boolean;
  headingRef: RefObject<HTMLHeadingElement>;
  go: Go;
}) {
  const few = results.total < FEW_MATCHES;
  const nobody = results.total === 0 && results.near.length === 0 && results.loosen.length === 0;

  return (
    <section className={`im-results ${pending ? "is-pending" : ""}`} aria-labelledby="results-heading" aria-busy={pending}>
      {pending && <span className="im-progress" aria-hidden="true" />}
      <div className="directory-label">
        <h2 id="results-heading" ref={headingRef} tabIndex={-1} aria-live="polite">
          Matches <span className="tabular">{results.total}</span>
        </h2>
        <span className="tabular">
          {results.databaseSize.toLocaleString("en-GB")} {results.databaseSize === 1 ? "person" : "people"} checked{results.total > 1 ? " · best fit first" : ""}
        </span>
      </div>

      {few && results.loosen.length > 0 && <Loosen results={results} go={go} />}

      {results.matches.length > 0 && (
        <ul className="people-list im-list" aria-label="Matches">
          {results.matches.map((row, index) => (
            <MatchRow key={row.id} row={row} index={index} roles={roles} defaultRoleId={defaultRoleId} readOnly={readOnly} go={go} />
          ))}
        </ul>
      )}

      {(results.showAllHref || results.unhideHref) && (
        <div className="im-list-foot">
          {results.showAllHref && <button type="button" className="btn-secondary" onClick={() => go(results.showAllHref!)}>Show all {results.total}</button>}
          {results.unhideHref && (
            <p>
              {results.hiddenCount} set aside as not a fit.{" "}
              <button type="button" className="im-link" onClick={() => go(results.unhideHref!, ["Showing everyone you set aside"], false)}>Show them again</button>
            </p>
          )}
        </div>
      )}

      {nobody && (
        <div className="card empty-state im-empty">
          <span className="empty-state-icon"><Icon name="search" size={26} /></span>
          <h3>No one in your database fits yet</h3>
          <p>
            Nobody matches every requirement, and nobody is one thing away.
            Remove a must-have above, or take the search to LinkedIn below.
          </p>
        </div>
      )}

      {results.near.length > 0 && (
        <div className="im-near">
          <div className="im-near-head">
            <div>
              <h3>One thing off <span className="tabular">{results.nearTotal}</span></h3>
              <p>Everything fits except the one thing marked. Often the person a quick call can settle.</p>
            </div>
          </div>
          {!few && results.loosen.length > 0 && <Loosen results={results} go={go} quiet />}
          <ul className="people-list im-list" aria-label="One thing off">
            {results.near.map((row, index) => (
              <MatchRow key={row.id} row={row} index={index} roles={roles} defaultRoleId={defaultRoleId} readOnly={readOnly} go={go} />
            ))}
          </ul>
          {results.nearTotal > results.near.length && (
            <p className="section-caption">Showing the closest {results.near.length} of {results.nearTotal}.</p>
          )}
        </div>
      )}
    </section>
  );
}

// What to loosen, with how many people each would bring in. The numbers come
// from the same people listed under "One thing off", so they are exact.
function Loosen({ results, go, quiet = false }: { results: Results; go: Go; quiet?: boolean }) {
  return (
    <div className={`im-loosen ${quiet ? "is-quiet" : ""}`}>
      {!quiet && (
        <p className="im-loosen-lead">
          {results.total === 0 ? "Nobody meets every requirement" : `Only ${results.total} ${results.total === 1 ? "person meets" : "people meet"} every requirement`}
          {results.loosenDepth === 2 ? ", and nobody is just one thing away." : "."}{" "}
          <span>{results.loosenDepth === 2 ? "Loosen two things together:" : "Loosen one thing:"}</span>
        </p>
      )}
      {quiet && <p className="im-loosen-lead"><span>To bring them in:</span></p>}
      <ul className="im-loosen-list">
        {results.loosen.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              className="im-loosen-option"
              onClick={() => {
                recordMatchEvent("match_loosened");
                go(option.href, [option.label]);
              }}
            >
              <span>{option.label}</span>
              <span className="im-gain tabular" aria-label={`brings in ${option.gain}`}>+{option.gain}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MatchRow({ row, index, roles, defaultRoleId, readOnly, go }: {
  row: MatchRowData;
  index: number;
  roles: RoleOption[];
  defaultRoleId: string | null;
  readOnly: boolean;
  go: Go;
}) {
  const onRoles = new Set(row.roles.map((role) => role.id));
  const free = roles.filter((role) => !onRoles.has(role.id));
  const preferred = free.find((role) => role.id === defaultRoleId) ?? free[0];

  return (
    <li className="im-row" style={{ animationDelay: `${Math.min(index, 10) * 28}ms` }}>
      <div className="im-row-identity">
        <div className="im-row-name-line">
          <Link href={`/people/${row.id}`} className="person-row-name">{row.fullName}</Link>
          {row.miss && (
            <span className={`im-miss ${row.miss.status === "unknown" ? "is-unknown" : ""}`}>
              {row.miss.status === "unknown" ? <Icon name="clock" size={12} /> : <Icon name="close" size={12} />}
              {row.miss.why}
            </span>
          )}
        </div>
        {row.headline && <p className="person-row-headline">{row.headline}</p>}
        <p className="person-row-facts">
          {row.facts.length ? row.facts.join(" / ") : <span className="text-ink-soft">No facts confirmed yet</span>}
          {row.stale && <span className="chip person-stale">May be out of date</span>}
        </p>
        {row.roles.length > 0 && (
          <p className="im-row-roles">On {row.roles.map((role, i) => <span key={role.id}>{i > 0 && ", "}<Link href={`/roles/${role.id}`}>{role.title}</Link></span>)}</p>
        )}
      </div>
      <ul className="im-hits" aria-label="Matched on">
        {row.hits.must.map((hit) => <li key={`m-${hit}`} className="im-hit is-must"><Icon name="check" size={11} />{hit}</li>)}
        {row.hits.nice.map((hit) => <li key={`n-${hit}`} className="im-hit">{hit}</li>)}
        {row.hits.titles.slice(0, 2).map((hit) => <li key={`t-${hit}`} className="im-hit is-title">{hit}</li>)}
      </ul>
      <div className="im-row-actions">
        <Popover
          name={`Add ${row.fullName} to a role`}
          className="btn-quiet"
          disabled={readOnly || free.length === 0 && roles.length > 0}
          title={readOnly ? "Read-only view" : free.length === 0 && roles.length > 0 ? "Already on every open role" : undefined}
          label={<><Icon name="plus" size={13} />Add to role</>}
        >
          {(close) => roles.length === 0 ? (
            <div className="im-editor">
              <p className="im-editor-title">No open roles</p>
              <div className="im-editor-actions"><Link href="/roles/new" className="btn-primary im-btn-small">New role</Link></div>
            </div>
          ) : (
            <ActionForm action={addPersonToRole} className="im-editor">
              <p className="im-editor-title">Add {row.fullName}</p>
              <input type="hidden" name="personId" value={row.id} />
              <label>
                <span className="field-label">To the role</span>
                <select name="roleId" className="field-input" defaultValue={preferred?.id}>
                  {free.map((role) => <option key={role.id} value={role.id}>{role.title}{role.client ? ` · ${role.client}` : ""}</option>)}
                </select>
              </label>
              <p className="im-editor-note">They join the role as sourced. Nothing is sent to them.</p>
              <div className="im-editor-actions">
                <button type="button" className="btn-quiet" onClick={close}>Close</button>
                <SubmitButton className="btn-primary im-btn-small" pendingLabel="Adding">Add</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Popover>
        <Popover name={`Why ${row.fullName} is not a fit`} className="btn-quiet" label="Not a fit">
          {(close) => (
            <div className="im-editor">
              <p className="im-editor-title">Why not?</p>
              <p className="im-editor-note">They are set aside, and the reason tightens the match so people like them go too.</p>
              <div className="im-menu">
                {row.notFit.map((option) => (
                  <button
                    key={option.reason}
                    type="button"
                    className="im-menu-item"
                    onClick={() => {
                      close();
                      recordMatchEvent("match_not_fit", option.reason);
                      go(option.href, [`Set aside ${row.fullName}`]);
                    }}
                  >
                    {option.label}
                    {option.reason === "other" && <span className="im-menu-sub">Set aside only this person</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Popover>
      </div>
    </li>
  );
}
