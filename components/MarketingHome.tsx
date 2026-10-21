import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { ContactBox } from "@/components/landing/ContactBox";
import { HeroBoard } from "@/components/landing/HeroBoard";
import { LandingMotion } from "@/components/landing/LandingMotion";
import { Pricing } from "@/components/landing/Pricing";
import "@/app/landing.css";

// The public homepage, ported from demo/landing. Everything on it is
// illustrative and static: no workspace data ever reaches this page.
// Each figure animates from --d, its start time within the figure.
const d = (delay: string) => ({ "--d": delay }) as CSSProperties;

// signupOpen: self-serve sign-up is configured (lib/signup-config.ts). Until
// it is, every way in is the contact box, as before.
export function MarketingHome({ signedIn = false, signupOpen = false }: { signedIn?: boolean; signupOpen?: boolean }) {
  const account = signedIn ? { href: "/", label: "Open workspace" } : { href: "/login", label: "Sign in" };
  return <div className="lp-page">
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <symbol id="lp-i-arrow" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></symbol>
        <symbol id="lp-i-down" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></symbol>
        <symbol id="lp-i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></symbol>
        <symbol id="lp-i-check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></symbol>
        <symbol id="lp-i-lock" viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></symbol>
        <symbol id="lp-i-bell" viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></symbol>
        <symbol id="lp-i-file" viewBox="0 0 24 24"><path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></symbol>
        <symbol id="lp-i-pause" viewBox="0 0 24 24"><path d="M9 6v12M15 6v12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></symbol>
        <symbol id="lp-i-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></symbol>
        <symbol id="lp-i-replay" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></symbol>
        <symbol id="lp-i-copy" viewBox="0 0 24 24"><path d="M9 9h11v11H9zM5 15H4V4h11v1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></symbol>
        <symbol id="lp-i-mail" viewBox="0 0 24 24"><path d="M3 5h18v14H3zM3 6l9 7 9-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></symbol>
        <symbol id="lp-i-export" viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M4 20h16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></symbol>
        <symbol id="lp-i-block" viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></symbol>
        <symbol id="lp-i-eye" viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12m13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></symbol>
        <symbol id="lp-i-clock" viewBox="0 0 24 24"><path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></symbol>
        <symbol id="lp-i-cursor" viewBox="0 0 24 24"><path d="M5 3l14 8-6.5 1.5L9.5 19z" fill="#18181b" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round"/></symbol>
        <symbol id="lp-i-mark" viewBox="0 0 32 32"><path d="M12 4H4v8M20 4h8v8M28 20v8h-8M12 28H4v-8" fill="none" stroke="currentColor" strokeWidth="3"/><path d="M12 12h8v8h-8z" fill="currentColor"/></symbol>
      </defs>
    </svg>

    <header className="lp-site-header lp-wrap">
      <nav className="lp-site-nav" aria-label="Main">
        <a href="#top" className="lp-brand" aria-label="Retrivr"><Image className="lp-logo" src="/brand/retrivr-logo.png" alt="Retrivr" width={953} height={215} unoptimized /></a>
        <div className="lp-nav-links">
          <a href="#how" className="lp-hide-sm">Features</a>
          <a href="#pricing" className="lp-hide-xs">Pricing</a>
          <a href="#faq" className="lp-hide-sm">FAQ</a>
          <a href="#contact" className="lp-hide-xs">Contact</a>
          <Link href={account.href} className="lp-btn lp-btn-dark">{account.label}</Link>
        </div>
      </nav>
    </header>

    <main id="main-content">
      <div id="top" className="lp-wrap">
        <section className="lp-frame lp-hero">
          <div className="lp-hero-copy">
                  <span className="lp-eyebrow lp-hero-label"><span className="lp-dot"></span>The recruiter’s workspace</span>
                  <h1>Good recruiting.<br /><span>Without the busywork.</span></h1>
                  <p>From the first profile to the client’s yes. Retrivr keeps every step in one place, and you make every move.</p>
                  <div className="lp-hero-actions">
                    <a href={signupOpen && !signedIn ? "/signup" : "#pricing"} className="lp-btn lp-btn-primary">Try Pro free for 7 days<svg><use href="#lp-i-arrow"/></svg></a>
                    <a href="#how" className="lp-btn">See how it works<svg><use href="#lp-i-down"/></svg></a>
                  </div>
                </div>
          <div className="lp-hero-stage"><HeroBoard /></div>
        </section>
      </div>

    {/* Find and reach out */}
    <div className="lp-wrap">
      <section className="lp-frame lp-section" id="how">
        <div className="lp-intro">
          <span className="lp-eyebrow">Find and reach out</span>
          <h2>From a profile<br /><span>to a first message.</span></h2>
        </div>
        <div className="lp-cards">

          <article className="lp-card" tabIndex={0} aria-labelledby="c1">
            <div className="lp-card-top"><span className="lp-step"><b>01</b> · Retrieve</span></div>
            <h3 id="c1">Save a LinkedIn profile in one click.</h3>
            <div className="lp-fig" role="img" aria-label="The Retrivr side panel fills a profile's name, headline, location and role, then the recruiter clicks Save.">
              <div className="lp-pane lp-f1-page">
                <div className="lp-f1-url"><svg><use href="#lp-i-lock"/></svg>linkedin.com/in/jamie-morgan</div>
                <div className="lp-f1-cover"></div>
                <div className="lp-f1-who"><span className="lp-f1-av">JM</span><strong>Jamie Morgan</strong><small>Data Engineer · Leeds</small></div>
                <div className="lp-f1-lines"><span className="lp-bar" style={{ width: "90%" }}></span><span className="lp-bar" style={{ width: "70%" }}></span><span className="lp-bar" style={{ width: "80%" }}></span></div>
              </div>
              <div className="lp-pane lp-f1-panel lp-k-slide" style={d(".1s")}>
                <header><Image src="/brand/retrivr-mark.png" alt="" width={265} height={215} unoptimized />Retrivr</header>
                <div className="lp-fld"><i>Name</i><span className="lp-k-type" style={d(".55s")}>Jamie Morgan</span></div>
                <div className="lp-fld"><i>Headline</i><span className="lp-k-type" style={d(".8s")}>Data Engineer</span></div>
                <div className="lp-fld"><i>Role</i><span className="lp-k-type" style={d("1.05s")}>Sr Data Engineer</span></div>
                <div className="lp-mini-btn lp-primary lp-k-press" style={d("2.05s")}>
                  <span className="lp-swap"><span className="lp-k-out" style={d("2.2s")}>Save</span><span className="lp-k-in" style={d("2.25s")}><svg><use href="#lp-i-check"/></svg> Saved</span></span>
                  <svg className="lp-cur" style={d("1.4s")}><use href="#lp-i-cursor"/></svg>
                </div>
              </div>
            </div>
            <button className="lp-replay" type="button"><svg><use href="#lp-i-replay"/></svg>Replay</button>
          </article>

          <article className="lp-card" tabIndex={0} aria-labelledby="c2">
            <div className="lp-card-top"><span className="lp-step"><b>02</b> · Search</span><span className="lp-plan">Basic+</span></div>
            <h3 id="c2">Search your own database first.</h3>
            <div className="lp-fig" role="img" aria-label="A pasted job brief turns into requirement chips, and the best three people already in your database appear, ranked.">
              <div className="lp-pane lp-f2-brief"><i>Paste a brief</i><p className="lp-k-type" style={{ "--d": ".1s", "--t": ".7s" } as CSSProperties}>Data engineer, Python + dbt, Leeds, up to £80k</p></div>
              <div className="lp-f2-chips">
                <span className="lp-tag lp-blue lp-k-pop" style={d(".95s")}>Python</span>
                <span className="lp-tag lp-blue lp-k-pop" style={d("1.05s")}>dbt</span>
                <span className="lp-tag lp-k-pop" style={d("1.15s")}>Leeds · hybrid</span>
                <span className="lp-tag lp-k-pop" style={d("1.25s")}>≤ £80k</span>
              </div>
              <div className="lp-pane lp-f2-list">
                <div className="lp-f2-row lp-k-in" style={d("1.55s")}><span className="lp-n">1</span><span><strong>Priya Nair</strong><small>Data Engineer · Leeds</small></span><span className="lp-score"><i className="lp-k-grow" style={{ "--d": "1.7s", width: "94%" } as CSSProperties}></i></span></div>
                <div className="lp-f2-row lp-k-in" style={d("1.7s")}><span className="lp-n">2</span><span><strong>Leo Brandt</strong><small>Analytics Engineer · York</small></span><span className="lp-score"><i className="lp-k-grow" style={{ "--d": "1.85s", width: "78%" } as CSSProperties}></i></span></div>
                <div className="lp-f2-row lp-k-in" style={d("1.85s")}><span className="lp-n">3</span><span><strong>Ana Ruiz</strong><small>Data Engineer · Remote</small></span><span className="lp-score"><i className="lp-k-grow" style={{ "--d": "2s", width: "61%" } as CSSProperties}></i></span></div>
              </div>
            </div>
            <button className="lp-replay" type="button"><svg><use href="#lp-i-replay"/></svg>Replay</button>
          </article>

          <article className="lp-card" tabIndex={0} aria-labelledby="c3">
            <div className="lp-card-top"><span className="lp-step"><b>03</b> · Contact</span></div>
            <h3 id="c3">Message one person at a time. You send.</h3>
            <div className="lp-fig" role="img" aria-label="An outreach queue card: the personalised message is copied and LinkedIn opens, the recruiter marks it sent, and the queue moves from 4 of 12 to 5 of 12. A weekly pace meter fills by one.">
              <div className="lp-pane lp-f3-card">
                <div className="lp-f3-top"><span>Outreach queue</span><span className="lp-swap"><span className="lp-k-out" style={d("2.45s")}>4 / 12</span><span className="lp-k-in" style={d("2.5s")}>5 / 12</span></span></div>
                <div className="lp-f3-prog"><i className="lp-k-grow" style={d("2.45s")}></i></div>
                <div className="lp-f3-name"><span className="lp-av">SP</span>Sam Patel</div>
                <div className="lp-f3-msg">Hi <mark className="lp-k-hl" style={d(".3s")}>Sam</mark>, I’m hiring a <mark className="lp-k-hl" style={d(".45s")}>Senior Data Engineer</mark> in <mark className="lp-k-hl" style={d(".6s")}>Leeds</mark>. Open to a chat?</div>
                <div className="lp-f3-pace"><span>This week</span><span className="lp-meter"><i className="lp-on"></i><i className="lp-on"></i><i className="lp-on"></i><i className="lp-on"></i><i className="lp-on lp-k-pop" style={d("2.5s")}></i><i></i><i></i><i></i><i></i><i></i></span></div>
                <div className="lp-f3-actions">
                  <span className="lp-mini-btn lp-primary lp-k-press" style={d("1.25s")}><svg><use href="#lp-i-copy"/></svg>Copy &amp; open<svg className="lp-cur" style={d(".6s")}><use href="#lp-i-cursor"/></svg></span>
                  <span className="lp-mini-btn lp-k-press" style={d("2.3s")}>Mark as sent<svg className="lp-cur" style={d("1.65s")}><use href="#lp-i-cursor"/></svg></span>
                </div>
              </div>
              <span className="lp-f3-toast lp-k-out" style={d("2.1s")}><span className="lp-k-in" style={{ "--d": "1.35s", display: "inline-block" } as CSSProperties}>Copied · paste it in LinkedIn</span></span>
            </div>
            <button className="lp-replay" type="button"><svg><use href="#lp-i-replay"/></svg>Replay</button>
          </article>

        </div>
      </section>
    </div>

    {/* Candidates and clients */}
    <div className="lp-wrap">
      <section className="lp-frame lp-section" id="clients">
        <div className="lp-intro">
          <span className="lp-eyebrow">Candidates and clients</span>
          <h2>From the first call<br /><span>to the client’s yes.</span></h2>
        </div>
        <div className="lp-cards">
          <article className="lp-card" tabIndex={0} aria-labelledby="c4">
            <div className="lp-card-top"><span className="lp-step"><b>04</b> · Book</span></div>
            <h3 id="c4">Let candidates pick their own time.</h3>
            <div className="lp-fig" role="img" aria-label="A booking page showing a week of free times, with times your calendar marks as busy hatched out. The candidate picks Wednesday 10:30 and it is booked.">
              <div className="lp-pane lp-f4-cal">
                <span></span><span className="lp-h">MON</span><span className="lp-h">TUE</span><span className="lp-h">WED</span><span className="lp-h">THU</span><span className="lp-h">FRI</span>
                <span className="lp-t">09:00</span><span className="lp-slot lp-busy"></span><span className="lp-slot"></span><span className="lp-slot lp-busy"></span><span className="lp-slot"></span><span className="lp-slot"></span>
                <span className="lp-t">10:30</span><span className="lp-slot"></span><span className="lp-slot lp-busy"></span><span className="lp-slot lp-pick lp-k-fill" style={d("1.15s")}>10:30<svg className="lp-cur" style={d(".4s")}><use href="#lp-i-cursor"/></svg></span><span className="lp-slot lp-busy"></span><span className="lp-slot"></span>
                <span className="lp-t">13:00</span><span className="lp-slot lp-busy"></span><span className="lp-slot"></span><span className="lp-slot"></span><span className="lp-slot"></span><span className="lp-slot lp-busy"></span>
                <span className="lp-t">15:30</span><span className="lp-slot"></span><span className="lp-slot"></span><span className="lp-slot lp-busy"></span><span className="lp-slot"></span><span className="lp-slot"></span>
              </div>
              <div className="lp-f4-foot">
                <span className="lp-legend"><i></i>Busy in your calendar</span>
                <span className="lp-tag lp-blue lp-k-pop" style={d("1.45s")}><svg width="10" height="10"><use href="#lp-i-check"/></svg>Booked · Wed 10:30</span>
              </div>
            </div>
            <button className="lp-replay" type="button"><svg><use href="#lp-i-replay"/></svg>Replay</button>
          </article>

          <article className="lp-card" tabIndex={0} aria-labelledby="c5">
            <div className="lp-card-top"><span className="lp-step"><b>05</b> · Screen</span><span className="lp-plan">Basic+</span></div>
            <h3 id="c5">Turn the call into confirmed facts.</h3>
            <div className="lp-fig" role="img" aria-label="Lines of a call transcript are highlighted one at a time, and each highlight becomes a confirmed fact card for salary, notice, location and right to work, each carrying its quote.">
              <div className="lp-pane lp-f5-tx">
                <p><b>YOU</b>What are you on now, and what’s your notice?</p>
                <p><b>SP</b><span><mark className="lp-k-hl" style={d(".3s")}>£75k base</mark>. <mark className="lp-k-hl" style={d(".8s")}>One month’s notice</mark>.</span></p>
                <p><b>SP</b><span><mark className="lp-k-hl" style={d("1.3s")}>Leeds, hybrid works</mark>. <mark className="lp-k-hl" style={d("1.8s")}>No sponsorship needed</mark>.</span></p>
              </div>
              <div className="lp-f5-facts">
                <div className="lp-fact lp-k-in" style={d(".45s")}><i>Salary</i><strong>£75,000</strong><small>“£75k base”</small><span className="lp-check lp-k-pop" style={d(".6s")}><svg><use href="#lp-i-check"/></svg></span></div>
                <div className="lp-fact lp-k-in" style={d(".95s")}><i>Notice</i><strong>1 month</strong><small>“One month’s notice”</small><span className="lp-check lp-k-pop" style={d("1.1s")}><svg><use href="#lp-i-check"/></svg></span></div>
                <div className="lp-fact lp-k-in" style={d("1.45s")}><i>Location</i><strong>Leeds · hybrid</strong><small>“Leeds, hybrid works”</small><span className="lp-check lp-k-pop" style={d("1.6s")}><svg><use href="#lp-i-check"/></svg></span></div>
                <div className="lp-fact lp-k-in" style={d("1.95s")}><i>Right to work</i><strong>Yes</strong><small>“No sponsorship needed”</small><span className="lp-check lp-k-pop" style={d("2.1s")}><svg><use href="#lp-i-check"/></svg></span></div>
              </div>
            </div>
            <button className="lp-replay" type="button"><svg><use href="#lp-i-replay"/></svg>Replay</button>
          </article>

          <article className="lp-card" tabIndex={0} aria-labelledby="c6">
            <div className="lp-card-top"><span className="lp-step"><b>06</b> · Submit</span></div>
            <h3 id="c6">Hand the client one link.</h3>
            <div className="lp-fig" role="img" aria-label="The client's shortlist page lists candidates with their CVs. The client clicks Interview next to Mei Chen and the recruiter gets a notification. The page never shows LinkedIn, email, phone or notes.">
              <div className="lp-pane lp-f6-win">
                <div className="lp-window-bar"><span className="lp-window-dots" aria-hidden="true"><i></i><i></i><i></i></span><svg width="9" height="9"><use href="#lp-i-lock"/></svg><span className="lp-grow">retrivr / s / 7fK2q…</span></div>
                <div className="lp-f6-body">
                  <h4>Senior Data Engineer · for Northwind</h4>
                  <div className="lp-f6-row"><strong><svg><use href="#lp-i-file"/></svg>Mei Chen</strong>
                    <span className="lp-acts"><span className="lp-mini-btn lp-primary lp-k-fillpress" style={d("1s")}><svg><use href="#lp-i-check"/></svg>Interview<svg className="lp-cur" style={d(".3s")}><use href="#lp-i-cursor"/></svg></span><span className="lp-mini-btn">Not for us</span></span></div>
                  <div className="lp-f6-row"><strong><svg><use href="#lp-i-file"/></svg>Tom Okafor</strong>
                    <span className="lp-acts"><span className="lp-mini-btn">Interview</span><span className="lp-mini-btn">Not for us</span></span></div>
                </div>
              </div>
              <div className="lp-f6-bell lp-k-pop" style={d("1.5s")}><span className="lp-bell"><svg><use href="#lp-i-bell"/></svg><span className="lp-badge">1</span></span>Interview Mei</div>
              <div className="lp-f6-hidden"><span>Never shown:</span><s>LinkedIn</s><s>Email</s><s>Phone</s><s>Your notes</s></div>
            </div>
            <button className="lp-replay" type="button"><svg><use href="#lp-i-replay"/></svg>Replay</button>
          </article>

        </div>
      </section>
    </div>

      {/* Pricing */}
      <div className="lp-wrap">
        <section className="lp-frame lp-section" id="pricing"><Pricing signupOpen={signupOpen && !signedIn} /></section>
      </div>

    {/* FAQ */}
    <div className="lp-wrap">
      <section className="lp-frame lp-section" id="faq">
        <div className="lp-faq">
          <div className="lp-intro"><span className="lp-eyebrow">FAQ</span><h2>Your questions.<br /><span>Short answers.</span></h2></div>
          <div className="lp-faq-list">
            <details><summary><span className="lp-idx">01</span>Could it get my LinkedIn account restricted?<svg><use href="#lp-i-plus"/></svg></summary>
              <div>Retrivr never contacts LinkedIn. The extension reads only the profile you are on, when you ask it to, and every message is sent by you. A counter shows how many you have sent today and this week. LinkedIn’s own limits are per account and unpublished, so pace yourself by that counter.</div></details>
            <details><summary><span className="lp-idx">02</span>Where is my data, and can I export or delete it?<svg><use href="#lp-i-plus"/></svg></summary>
              <div>Each account’s data is kept separate in Retrivr’s own database. You can export it at any time. When you delete a person, they stay on a do-not-contact list, so re-importing a spreadsheet won’t bring them back. Call transcripts are deleted after 30 days.</div></details>
            <details><summary><span className="lp-idx">03</span>Does Retrivr adapt to my own workflow?<svg><use href="#lp-i-plus"/></svg></summary>
              <div>Yes. Each part of Retrivr works on its own, so you use the parts that fit how you already work and leave the rest. It also works with the mainstream calendar, meeting and note-taking apps you already use. On Pro and Pro Max you can talk to our team directly about custom features for your own desk.</div></details>
            <details><summary><span className="lp-idx">04</span>Which plan do I need? Is there a trial?<svg><use href="#lp-i-plus"/></svg></summary>
              <div>Lite covers the day-to-day pipeline. Basic adds your own talent database and screening summaries. Pro adds client sign-off, reply suggestions and an email finder, and you can try it free for 7 days.</div></details>
            <details><summary><span className="lp-idx">05</span>How do I get an account?<svg><use href="#lp-i-plus"/></svg></summary>
              <div>{signupOpen ? <>Sign up yourself with Google, Microsoft or your email. You get seven days of Pro with no card; when it ends, choose a plan to keep working. For a team account or custom work, write to us.</> : <>Retrivr is in beta testing right now, so there is no public sign-up yet. Email us and we will set up your account, then send you a one-time link to register your password.</>}</div></details>
          </div>
        </div>
      </section>
    </div>

      {/* Contact */}
      <div className="lp-wrap">
        <section className="lp-frame lp-closing" id="contact">
          <span className="lp-eyebrow">Less friction. More focus.</span>
          <h2>Make room for<br /><span>the human part.</span></h2>
          <ContactBox />
          <p className="lp-closing-note">{signupOpen && !signedIn ? <>Ready to try it? <Link href="/signup">Start your free trial</Link>. A team account or custom work: write to us.</> : <>Plans, trials or a team account: write to us. Already invited? <Link href={account.href}>{account.label}</Link>.</>}</p>
        </section>
      </div>
    </main>

    <div className="lp-wrap" style={{ borderTop: "1px solid var(--line)" }}>
      <footer className="lp-site-footer">
        <a href="#top" className="lp-brand" aria-label="Retrivr"><Image className="lp-logo lp-logo-sm" src="/brand/retrivr-logo.png" alt="Retrivr" width={953} height={215} unoptimized /></a>
        <nav aria-label="Footer"><a href="#how">Features</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a><a href="#contact">Contact</a><Link href={account.href}>{account.label}</Link></nav>
        <span>© 2026 Retrivr</span>
      </footer>
    </div>
    <LandingMotion />
  </div>;
}
