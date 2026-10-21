import Link from "next/link";
import { LEGAL_VERSION, legalDetailsComplete } from "@/lib/legal";

// The frame of /terms and /privacy: a plain, readable document with its date,
// and a visible notice while the operator's details are still missing.
export function LegalDocument({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: React.ReactNode; children: React.ReactNode }) {
  const draft = !legalDetailsComplete();
  return <article className="legal-doc">
    <header>
      <p className="page-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="legal-meta">Last updated {LEGAL_VERSION}</p>
      {draft && <p role="status" className="legal-draft">Draft, not yet in force: the details in square brackets are still to be filled in.</p>}
      <div className="legal-intro">{intro}</div>
    </header>
    {children}
    <footer className="legal-footer"><Link href="/terms">Terms of service</Link> · <Link href="/privacy">Privacy policy</Link> · <Link href="/welcome">Back to Retrivr</Link></footer>
  </article>;
}

export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section id={id} aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>{title}</h2>
    {children}
  </section>;
}
