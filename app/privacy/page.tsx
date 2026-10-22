import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, Section } from "@/components/LegalDocument";
import { OPERATOR, detail, operatorName } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy policy · Retrivr" };

// What Retrivr keeps about the recruiters who use it, and what it does with
// the people in their workspaces. Every statement here is something the
// software does (see AGENTS.md); keep them in step, and change LEGAL_VERSION.
export default function PrivacyPage() {
  const contact = detail(OPERATOR.contactEmail, "contact email");
  return <LegalDocument eyebrow="LEGAL" title="Privacy policy" intro={<>
    <p>Retrivr is run by {operatorName()}, of {detail(OPERATOR.address, "postal address")} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). This policy explains what we keep about you when you use Retrivr, and why. For anything about it, or to use your rights, write to {contact}.{OPERATOR.icoNumber ? ` We are registered with the Information Commissioner's Office under ${OPERATOR.icoNumber}.` : ""}</p>
  </>}>
    <Section id="roles" title="1. Two kinds of data">
      <ul>
        <li><strong>Your account.</strong> For your own details as a Retrivr user (your name, email, sign-in and billing), we are the controller, and this policy covers them.</li>
        <li><strong>The people in your workspace.</strong> Candidates, clients and other contacts that recruiters keep in Retrivr belong to that recruiter, who is their controller. We process that data only on the recruiter&rsquo;s behalf, under the <Link href="/terms#data-processing">data processing terms</Link>. If you are a candidate or a client, the recruiter who contacted you can tell you what they keep and why, and answer your requests; the booking pages they send say how to reach them. If you write to us instead, we will pass your request on.</li>
      </ul>
    </Section>

    <Section id="what" title="2. What we keep about you">
      <ul>
        <li><strong>Your account:</strong> your name and email address; your password, stored only as a scrypt hash; whether Google or Microsoft confirmed your address, and their account id if you sign in with them; the version and date of the terms you accepted.</li>
        <li><strong>Your plan and payments:</strong> your plan, its status and renewal date, and the Stripe customer and subscription ids. Your card details go straight to Stripe and never reach us.</li>
        <li><strong>Your settings and workspace:</strong> what you enter, such as your outreach details, booking hours and templates, and the work you keep in Retrivr (see section 1).</li>
        <li><strong>Usage and security records:</strong> counts and timings of features used (never names, messages or transcripts), a record of account events such as sign-ups, password changes and deletions, and short-lived, hashed records of sign-in and sign-up attempts per address and per network address, to stop abuse.</li>
        <li><strong>Email we send you:</strong> sign-up codes, password-reset links and account notices. We send no marketing email.</li>
      </ul>
    </Section>

    <Section id="why" title="3. Why, and on what basis">
      <ul>
        <li>To provide Retrivr, take payment and keep your account working: necessary for our contract with you.</li>
        <li>To keep Retrivr secure, prevent abuse (for example, one free trial per email address) and improve it from usage counts: our legitimate interests, which we have balanced against yours.</li>
        <li>To keep billing records and meet other legal duties: legal obligation.</li>
      </ul>
    </Section>

    <Section id="sharing" title="4. Who else handles it">
      <p>We do not sell personal data or use it for advertising. These providers handle data for us, each under its own data protection terms:</p>
      <ul>
        <li><strong>Render</strong> runs Retrivr and its database, in {OPERATOR.hostingLocation}.</li>
        <li><strong>Stripe</strong> takes payments and manages subscriptions.</li>
        <li><strong>Resend</strong> delivers the account emails we send you.</li>
        <li><strong>Anthropic</strong> runs the AI features. Only what you send when you use one (a job description, a transcript or CV, a reply you pasted, a brief) is passed to it, to return the result. Under its commercial terms it does not use this to train its models.</li>
        <li><strong>Google and Microsoft</strong>, if you sign in with them, or connect your calendar to read busy times for your booking page.</li>
        <li><strong>Notion</strong>, if you connect it to import meeting notes.</li>
        <li><strong>Enrow</strong> looks up a person&rsquo;s work email when you press Find email. Only that person&rsquo;s LinkedIn profile address, or their name and the company you confirm, is sent to it, and only on that click; the email it finds is saved on the person.</li>
        <li><strong>Cloudflare</strong> answers DNS queries for retrivr.app. It does not see what you send to Retrivr.</li>
      </ul>
      <p>We may also share data where the law requires it, or to protect our rights or someone&rsquo;s safety.</p>
    </Section>

    <Section id="transfers" title="5. Where it is processed">
      <p>Retrivr&rsquo;s servers and database are in {OPERATOR.hostingLocation}, which the UK recognises as giving adequate protection. Some of the providers above process data elsewhere, mainly in the United States. Where they do, the transfer relies on the UK&rsquo;s adequacy regulations (including the UK extension to the EU-US Data Privacy Framework) or on the UK&rsquo;s approved safeguards.</p>
    </Section>

    <Section id="retention" title="6. How long we keep it">
      <ul>
        <li>Your account and workspace: until you delete them. Deleting your account (from Your account) removes them straight away, and cancels a paid subscription.</li>
        <li>Call transcripts: deleted 30 days after they are added, sooner if you delete them.</li>
        <li>A sign-up that was never confirmed: 30 minutes. Sign-up codes: 10 minutes. Password-reset links: one hour.</li>
        <li>Kept after an account is deleted: a one-way hash of the email address, so the same address cannot start another free trial; account events, without names; and the payment records Stripe and we must keep for tax, usually six years.</li>
      </ul>
    </Section>

    <Section id="cookies" title="7. Cookies and storage">
      <p>Retrivr uses only what it needs to work: no analytics, no advertising and no third-party tracking. That is a cookie that keeps you signed in; short-lived cookies used while you sign up, sign in with Google or Microsoft, or open a client link someone shared with you; and your browser&rsquo;s own storage, which remembers things like where you were in a follow-up run.</p>
    </Section>

    <Section id="security" title="8. Security">
      <p>Each account&rsquo;s data is kept separate from every other. Passwords, sessions and extension keys are stored only as hashes, connection tokens for Google, Microsoft and Notion are encrypted, and everything travels over HTTPS. Administrators can see an account only through a read-only view that is recorded.</p>
    </Section>

    <Section id="rights" title="9. Your rights">
      <p>You can ask to see, correct, delete or receive a copy of your personal data, or object to or restrict how we use it. Much of it you can do yourself: export your data from the app and delete your account from Your account. For anything else, write to {contact}. We will answer within one month.</p>
      <p>If you are unhappy with how we handle your data, you can complain to the Information Commissioner&rsquo;s Office at <a href="https://ico.org.uk" rel="noreferrer">ico.org.uk</a>.</p>
    </Section>

    <Section id="changes" title="10. Changes">
      <p>Retrivr is for people recruiting in their work, not for children. If we change this policy in a way that matters, we will tell you by email or in the app before it applies. The date at the top shows which version this is.</p>
    </Section>
  </LegalDocument>;
}
