"use client";

import { useState } from "react";
import { CaptureMark, Icon } from "@/components/Icon";

const tabs = ["Pipeline", "Briefing", "Outreach"] as const;
const people = [
  { initials: "JM", name: "Jamie Morgan", title: "Senior Finance Analyst", stage: "Sourced", time: "Just added" },
  { initials: "AL", name: "Alex Lee", title: "Commercial Finance Manager", stage: "Contacted", time: "Yesterday" },
  { initials: "SP", name: "Sam Patel", title: "FP&A Analyst", stage: "Replied", time: "Today" },
];

export function ProductPreview() {
  const [tab, setTab] = useState<typeof tabs[number]>("Pipeline");
  return <section className="product-preview" aria-label="Product preview">
    <div className="preview-window-bar"><span className="window-dots" aria-hidden="true"><i /><i /><i /></span><span>capture / workspace</span><span className="preview-private"><Icon name="lock" size={11} />Private by design</span></div>
    <div className="preview-body">
      <aside className="preview-sidebar" aria-hidden="true">
        <div className="brand preview-brand"><CaptureMark /><span>Capture</span></div>
        <span className="preview-workspace">My workspace</span>
        {([['roles', 'Roles'], ['people', 'Candidates'], ['message', 'Templates'], ['clock', 'Follow-ups']] as const).map(([icon, label], index) => <div key={label} className={`preview-nav-item ${index === 0 ? "selected" : ""}`}><Icon name={icon} size={15} />{label}</div>)}
        <div className="preview-user"><span className="avatar">AR</span><span>Alex Recruiter<small>Personal workspace</small></span></div>
      </aside>
      <div className="preview-content">
        <div className="preview-heading"><div><span className="eyebrow">A role. A shortlist. A clear next step.</span><h3>Finance Analyst</h3></div><span className="chip">Open role</span></div>
        <div role="tablist" aria-label="Preview a workflow" className="preview-tabs">
          {tabs.map((name, index) => <button key={name} id={`preview-tab-${name}`} role="tab" type="button" aria-selected={tab === name} aria-controls={`preview-panel-${name}`} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={(event) => {
            const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
            if (next !== null) { event.preventDefault(); setTab(tabs[next]); document.getElementById(`preview-tab-${tabs[next]}`)?.focus(); }
          }}>{name}</button>)}
        </div>
        <div id={`preview-panel-${tab}`} role="tabpanel" aria-labelledby={`preview-tab-${tab}`} tabIndex={0} className="preview-panel">
          {tab === "Pipeline" && <>
            <div className="preview-metrics"><div><span>Shortlisted</span><strong>03</strong></div><div><span>Conversation started</span><strong>02</strong></div><div><span>Next action</span><strong className="text-accent">01</strong></div></div>
            <div className="preview-table"><div className="preview-table-head"><span>Candidate</span><span>Stage</span><span>Activity</span></div>{people.map((person) => <div key={person.name} className="preview-person"><div><span className="avatar">{person.initials}</span><span><strong>{person.name}</strong><small>{person.title}</small></span></div><span className={`preview-stage ${person.stage === "Replied" ? "is-blue" : ""}`}><i />{person.stage}</span><span className="preview-time">{person.time}</span></div>)}</div>
          </>}
          {tab === "Briefing" && <div className="preview-briefing"><div className="preview-section-label"><Icon name="spark" size={15} />A better starting point</div><h4>Know what good looks like.</h4><p>Own the month-end story, explain the commercial drivers, and turn financial data into decisions.</p><div className="preview-skill-list"><span>Month-end ownership</span><span>Variance analysis</span><span>Stakeholder partnering</span></div><div className="preview-question"><span className="eyebrow">A useful first question</span><p>Tell me about a time your analysis changed a business decision.</p></div></div>}
          {tab === "Outreach" && <div className="preview-outreach"><div className="preview-section-label"><Icon name="message" size={15} />Thoughtful, not automated</div><p>Hi <mark>Jamie</mark>,</p><p>I’m recruiting for a <mark>Finance Analyst</mark> and your background caught my attention. Would you be open to a quick conversation?</p><p>Best,<br />Alex</p><div className="preview-message-note"><Icon name="check" size={14} />Personalised and ready for your review. You send it yourself.</div></div>}
        </div>
        <div className="preview-caption"><span className="status-dot" />Illustrative data · not a real candidate workspace</div>
      </div>
    </div>
  </section>;
}
