import Link from "next/link";
import { CaptureMark, Icon } from "@/components/Icon";
import { ProductPreview } from "@/components/ProductPreview";

const features = [
  { number: "01", icon: "file", title: "Start with a sharper brief.", text: "Turn a job description into a practical briefing: the skills that matter, useful search terms and better first-call questions." },
  { number: "02", icon: "people", title: "Keep the person in the picture.", text: "Save a profile, add your own assessment and keep every candidate connected to the right role. Context stays close." },
  { number: "03", icon: "message", title: "Make every message yours.", text: "Reusable templates fill in the details. You review the words, copy the message and make the connection yourself." },
  { number: "04", icon: "clock", title: "Know who needs a follow-up.", text: "See who replied, who is ready to book and who went quiet, using the stages and timestamps you have recorded." },
] as const;
const questions = [
  ["Does Capture contact people for me?", "No. Capture prepares message drafts and puts them on your clipboard. You choose what to say and send it yourself. It does not automate messages or connection requests."],
  ["How does the browser extension work?", "You open a profile and click the extension. It reads that one page, fills the editable fields and lets you add your own notes. Nothing is saved until you click save. There is no background browsing or bulk capture."],
  ["Can other users see my recruiting work?", "Each account has its own roles, candidates, templates and settings. An administrator can enter an audited, read-only view for oversight, but cannot edit your recruiting data from that view."],
  ["How do I get an account?", "Access is managed by your administrator. They create your account and share a one-time setup link so you can set your own password. Public registration is not enabled."],
  ["Do I need AI to use Capture?", "No. Roles, candidate records, saved searches, templates and follow-ups work without an AI key. Briefing generation is optional and must be configured by your administrator."],
];

export function MarketingHome() {
  return <div className="marketing-page">
    <section className="marketing-hero frame-section">
      <div className="hero-copy">
        <span className="eyebrow hero-label"><span className="status-dot" />THE RECRUITER’S WORKSPACE</span>
        <h1>Good recruiting.<br /><span>Without the busywork.</span></h1>
        <p>From the first brief to the next conversation. Capture brings your roles, people and follow-ups into focus — with you in control.</p>
        <div className="hero-actions"><Link href="/login" className="btn-primary">Open your workspace<Icon name="arrow" size={17} /></Link><a href="#workflow" className="btn-secondary">See how it works<Icon name="down" size={16} /></a></div>
        <p className="hero-footnote">One place for the details. More space for your judgement.</p>
      </div>
      <div className="hero-preview-wrap"><span className="frame-coordinate" aria-hidden="true">FIG. 01 — A CLEARER PICTURE</span><ProductPreview /></div>
    </section>

    <div className="workflow-strip"><span>BUILT AROUND HOW RECRUITERS WORK</span><div><strong>Brief</strong><Icon name="arrow" size={16} /><strong>Source</strong><Icon name="arrow" size={16} /><strong>Connect</strong><Icon name="arrow" size={16} /><strong>Follow through</strong></div></div>

    <section id="features" className="marketing-section frame-section">
      <div className="section-intro"><span className="eyebrow">THE COMPLETE PICTURE</span><h2>Less scattered context.<br /><span>More considered action.</span></h2><p>A focused set of tools for the parts of recruiting that should feel simpler.</p></div>
      <div className="feature-grid">{features.map((feature) => <article className="feature-card" key={feature.number}><div className="feature-card-top"><span className="feature-icon"><Icon name={feature.icon} size={23} /></span><span className="eyebrow">/{feature.number}</span></div><h3>{feature.title}</h3><p>{feature.text}</p></article>)}</div>
    </section>

    <section id="workflow" className="marketing-section workflow-section frame-section">
      <div className="workflow-story"><span className="eyebrow">A NATURAL FLOW</span><h2>From a promising profile<br />to a meaningful<br /><span className="text-accent">conversation.</span></h2><p>No new process to learn. Just a clearer place for the work you already do.</p><Link href="/login" className="text-link">Find your focus<Icon name="arrow" size={17} /></Link></div>
      <div className="workflow-steps">{[
        ["01", "Make the role make sense.", "Keep the brief, search criteria and candidate list together. Start with a job description; build a useful picture of the person you need.", "file"],
        ["02", "Capture the context that matters.", "Save people you have chosen, then add what only you know: why they fit, what stood out and what you want to ask.", "people"],
        ["03", "Move the conversation forward.", "Prepare a personal message and keep track of the next step. Follow-ups stay visible, instead of disappearing into another tab.", "message"],
      ].map(([number, title, text, icon]) => <article key={number} className="workflow-step"><span className="step-number">{number}</span><div><h3>{title}</h3><p>{text}</p></div><Icon name={icon as "file" | "people" | "message"} size={19} /></article>)}</div>
    </section>

    <section id="principles" className="principles-section">
      <div className="principles-inner"><div><span className="eyebrow">HUMAN BY DESIGN</span><h2>Software handles<br />the preparation.<br /><span>You own the decision.</span></h2><p>The best recruiting is personal. Capture takes care of the organisation without taking over the conversation.</p><div className="principle-pills"><span><Icon name="check" size={15} />No automated messaging</span><span><Icon name="check" size={15} />No background browsing</span><span><Icon name="check" size={15} />Your notes, your judgement</span></div></div>
      <div className="system-illustration" aria-hidden="true"><div className="system-orbit orbit-one" /><div className="system-orbit orbit-two" /><div className="system-orbit orbit-three" /><div className="system-core"><CaptureMark /></div><div className="system-node node-top"><Icon name="file" size={20} /><span>Brief ready</span><i /></div><div className="system-node node-left"><Icon name="people" size={20} /><span>Context saved</span><i /></div><div className="system-node node-bottom"><Icon name="message" size={20} /><span>Your next move</span><i /></div><span className="system-caption">ORGANISED BY CAPTURE. LED BY YOU.</span></div>
      </div>
    </section>

    <section id="faq" className="marketing-section faq-section frame-section"><div className="section-intro"><span className="eyebrow">A FEW GOOD QUESTIONS</span><h2>Clarity, before<br /><span>you get started.</span></h2><p>The essentials about your workspace and how it works.</p></div><div className="faq-list">{questions.map(([question, answer], index) => <details key={question}><summary><span className="faq-index">0{index + 1}</span>{question}<Icon name="plus" size={18} /></summary><p>{answer}</p></details>)}</div></section>

    <section className="closing-section frame-section"><span className="eyebrow">LESS FRICTION. MORE FOCUS.</span><h2>Make room for<br /><span className="text-accent">the human part.</span></h2><Link href="/login" className="btn-primary">Open your workspace<Icon name="arrow" size={17} /></Link><p>Already invited? Sign in and pick up where you left off.</p></section>
    <footer className="site-footer"><div><Link href="/welcome" className="brand" aria-label="Capture"><CaptureMark /><span>Capture</span></Link><p>A clearer workspace for better recruiting.</p></div><div className="footer-links"><a href="#features">Features</a><a href="#workflow">Workflow</a><a href="#faq">FAQ</a><Link href="/login">Sign in</Link></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Capture</span><span>Thoughtful tools. Human decisions.</span></div></footer>
  </div>;
}
