import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/Icon";

// The sign-in page's two halves, shared by sign-up, its code and the password
// reset, so every way in looks like the same door.
export function AuthFrame({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: React.ReactNode; children: React.ReactNode }) {
  return <div className="login-page">
    <section className="login-story" aria-label="Retrivr workspace introduction">
      <div className="login-story-heading"><span className="eyebrow">RECRUITING, IN FOCUS</span><span className="login-coordinate">01 / RETRIVR</span></div>
      <h2>Less scattered.<br />More connected.<br /><span>All in focus.</span></h2>
      <p>The details in one place.<br />The next conversation in your hands.</p>
      <div className="login-art" aria-hidden="true"><div className="login-art-grid" /><div className="login-orbit orbit-one" /><div className="login-orbit orbit-two" /><div className="login-art-core"><Image src="/brand/retrivr-mark.png" alt="" width={265} height={215} unoptimized /></div><span className="login-art-node login-art-node-a"><Icon name="file" size={18} />A sharper brief</span><span className="login-art-node login-art-node-b"><Icon name="people" size={18} />The right context</span><span className="login-art-node login-art-node-c"><Icon name="message" size={18} />A better conversation</span></div>
      <div className="login-story-footer"><span className="status-dot" />Prepared by software. Decided by you.</div>
    </section>
    <section className="login-form-panel">
      <div className="login-form-content"><div className="login-symbol"><Image src="/brand/retrivr-mark.png" alt="" width={265} height={215} unoptimized /></div><p className="page-eyebrow">{eyebrow}</p><h1>{title}</h1><p className="login-description">{description}</p>
        {children}
        <div className="login-security"><Icon name="shield" size={15} /><span>Your recruiting work stays in your own workspace.</span></div>
      </div>
      <Link href="/welcome" className="login-back"><Icon name="arrow" size={15} />Back to Retrivr</Link>
    </section>
  </div>;
}
