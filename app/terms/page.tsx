import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, Section } from "@/components/LegalDocument";
import { OPERATOR, detail, operatorName } from "@/lib/legal";
import { PAST_DUE_GRACE_DAYS, TRIAL_DAYS } from "@/lib/account-tiers";

export const metadata: Metadata = { title: "Terms of service · Retrivr" };

// Written for recruiters and small agencies using Retrivr in their business.
// Every promise here is something the software does (see AGENTS.md); change
// the text and LEGAL_VERSION together when the product changes.
export default function TermsPage() {
  const contact = detail(OPERATOR.contactEmail, "contact email");
  return <LegalDocument eyebrow="LEGAL" title="Terms of service" intro={<>
    <p>These terms are the agreement between you and {operatorName()}, of {detail(OPERATOR.address, "postal address")}, who runs Retrivr (&ldquo;we&rdquo;, &ldquo;us&rdquo;). You accept them when you tick the box to create an account.</p>
    <p>Retrivr is for people who recruit as part of their business. It is not for consumers or for anyone under 18. If you sign up for an organisation, you confirm you may bind it to these terms.</p>
  </>}>
    <Section id="account" title="1. Your account">
      <ul>
        <li>Give us your real name and an email address you control, and keep them up to date.</li>
        <li>An account is for one person. Each plan is priced per seat: do not share your sign-in or your extension&rsquo;s capture key with anyone else.</li>
        <li>Keep your password and capture key secret. You are responsible for what happens under your account. Tell us at {contact} if you think someone else has used it.</li>
      </ul>
    </Section>

    <Section id="trial" title="2. The free trial">
      <p>A new account gets {TRIAL_DAYS} days of the Pro plan, with no card needed. Each email address gets one trial, even if the account is deleted and made again. The trial has smaller monthly limits on AI features than paid Pro.</p>
      <p>When the trial ends without a plan, your workspace becomes read-only. Nothing is deleted: you can still sign in, read, export and delete your data, and choose a plan at any time to carry on.</p>
    </Section>

    <Section id="plans" title="3. Plans, payment and cancelling">
      <ul>
        <li>Prices are on our <Link href="/welcome#pricing">pricing page</Link>, per seat, excluding VAT. What each plan includes, and its monthly limits on AI features, are shown there and in the app. Limits reset at the start of each calendar month (UTC).</li>
        <li>You pay monthly or yearly in advance through Stripe, our payment provider. A plan renews automatically at the end of each period until you cancel it.</li>
        <li>You can cancel or change plan at any time from Billing. A cancellation takes effect at the end of the period you have paid for, and the plan stays until then. We do not refund part of a period, except where the law requires it.</li>
        <li>If a payment fails, Stripe tries again. Your plan stays for {PAST_DUE_GRACE_DAYS} days while it does; after that the workspace becomes read-only until payment succeeds.</li>
        <li>We may change our prices or plans. We will tell you at least 30 days before a change affects you, and it applies from your next renewal.</li>
      </ul>
    </Section>

    <Section id="your-data" title="4. Your data and the people in it">
      <p>What you put into Retrivr is yours: your roles, notes and messages, and the details of candidates, clients and other people you keep there. You can export it at any time and delete it, or your whole account, from the app.</p>
      <p>For the personal data of the people in your workspace, you are the controller and we are your processor. You are responsible for having a lawful basis to hold and use that data, for telling those people what you do with it, and for answering their requests. We process it only to provide Retrivr to you, as set out in the <a href="#data-processing">data processing terms</a> below. Our <Link href="/privacy">privacy policy</Link> explains what we do with your own account data.</p>
    </Section>

    <Section id="acceptable-use" title="5. Using Retrivr properly">
      <p>You must not use Retrivr, or let anyone else use it, to:</p>
      <ul>
        <li>break the law, including data protection, employment and anti-discrimination law;</li>
        <li>break the terms of other services you use alongside it, including LinkedIn&rsquo;s. Retrivr never contacts LinkedIn and never sends messages for you; the browser extension reads only the profile you are on, when you click. Do not use Retrivr, or tools around it, to automate LinkedIn, scrape it or send messages in bulk;</li>
        <li>store sensitive personal data (such as health, ethnicity or criminal records) that you do not need and are not allowed to hold;</li>
        <li>send spam or contact people who have asked you not to;</li>
        <li>copy, resell or reverse-engineer Retrivr, get around its limits or security, test its security without our written permission, or put an unreasonable load on it.</li>
      </ul>
    </Section>

    <Section id="ai" title="6. AI features">
      <p>Some features use an AI model: role briefings, screening summaries, suggested replies and matching a brief to your database. They run only when you ask, and what you send is passed to our AI provider to produce the result.</p>
      <p>AI output can be wrong. Retrivr marks facts it could not find in a transcript, and you confirm each one before it is saved, but checking the output is your responsibility. Do not use it as the only basis for a decision about a person: the decision is yours.</p>
    </Section>

    <Section id="service" title="7. The service">
      <ul>
        <li>We work to keep Retrivr available and your data safe, but we do not promise it will always be available or free of errors. We may need to stop it for maintenance.</li>
        <li>We may change, add or remove features. If we remove something that is central to your paid plan, we will give you reasonable notice, and you may cancel and get back what you paid for the time after the change.</li>
        <li>Google, Microsoft, Notion and other services you connect have their own terms, and we are not responsible for them.</li>
      </ul>
    </Section>

    <Section id="ending" title="8. Suspension and ending">
      <p>You can delete your account at any time from Your account; a paid subscription is cancelled with it. We may suspend or close an account that breaks these terms, does not pay, or puts Retrivr or other people at risk. Where we reasonably can, we will tell you first and give you the chance to export your data. When an account is deleted, its data is deleted as described in the privacy policy.</p>
    </Section>

    <Section id="liability" title="9. Our liability">
      <ul>
        <li>Nothing in these terms limits liability that the law does not allow to be limited, such as for death or personal injury caused by negligence, or for fraud.</li>
        <li>We are not liable for loss of profit, revenue, business, contracts, goodwill or data you could have exported, or for any indirect loss.</li>
        <li>Otherwise, our total liability to you in any 12 months is limited to what you paid us in those 12 months, or £100 if that is more.</li>
      </ul>
    </Section>

    <Section id="changes" title="10. Changes to these terms">
      <p>We may update these terms. We will tell you about a change that matters at least 30 days before it applies, by email or in the app. The date at the top shows which version this is, and your account records the version you agreed to.</p>
    </Section>

    <Section id="law" title="11. Law">
      <p>These terms are governed by the law of {OPERATOR.jurisdiction}, and the courts of {OPERATOR.jurisdiction} decide any dispute about them. Questions about these terms: {contact}.</p>
    </Section>

    <Section id="data-processing" title="Data processing terms">
      <p>These terms apply where we process personal data for you as your processor, under Article 28 of the UK GDPR.</p>
      <ul>
        <li><strong>What and why.</strong> We process the personal data in your workspace for as long as your account exists, only to provide Retrivr to you. It is mainly names, job titles, profile links, contact details, notes, call transcripts, CVs, details a person gives about pay, notice, location and right to work, and messages, about candidates, clients and other contacts.</li>
        <li><strong>Your instructions.</strong> We act only on your documented instructions, which are these terms and how you use Retrivr, unless the law requires otherwise; if it does, we will tell you unless the law forbids that.</li>
        <li><strong>Confidentiality and security.</strong> Everyone who can access the data is bound to keep it confidential. We keep each account&rsquo;s data separate, store passwords, sessions and keys only as hashes, encrypt data in transit and connection tokens at rest, and limit who can reach the production systems.</li>
        <li><strong>Sub-processors.</strong> You allow us to use the sub-processors listed in our <Link href="/privacy#sharing">privacy policy</Link>. We bind each of them to data protection terms at least as protective as these. We will update that list before adding or replacing one, and you may object; if we cannot address your objection, you may cancel.</li>
        <li><strong>Transfers.</strong> Where data is processed outside the UK, we rely on UK adequacy regulations or the UK&rsquo;s approved safeguards, such as the International Data Transfer Addendum.</li>
        <li><strong>Helping you.</strong> Retrivr lets you find, correct, export and delete a person&rsquo;s data and mark them do not contact. We will help with requests from people, with assessments and with consultations where you reasonably need us.</li>
        <li><strong>Breaches.</strong> We will tell you without undue delay after we become aware of a personal data breach affecting your data, with what we know.</li>
        <li><strong>At the end.</strong> When you delete your account we delete the data in it, except what the law requires us to keep. You can export it first.</li>
        <li><strong>Showing compliance.</strong> We will give you the information you reasonably need to show these terms are being met.</li>
      </ul>
    </Section>
  </LegalDocument>;
}
