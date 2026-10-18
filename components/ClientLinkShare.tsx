"use client";

import { useId, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { mailtoHref, mailtoSubjectOnly } from "@/lib/client-email";
import { normalizeMessage } from "@/lib/render";

// The address of a client link or shortlist, and the one way Capture helps send it:
// an email the recruiter opens in their own app. The recipient field has no
// form name, so it is never submitted or stored.
export function ClientLinkShare({ link, roleTitle, client, recruiterName, kind = "role", to }: {
  link: string;
  // The role, or the shortlist's own name.
  roleTitle: string;
  client: string | null;
  recruiterName: string;
  kind?: "role" | "custom";
  // A named person's own link: the email goes to them and to nobody typed in.
  to?: string;
}) {
  const id = useId();
  const [typed, setRecipient] = useState("");
  const recipient = to ?? typed;
  const subject = kind === "role" ? `Candidates for ${roleTitle}` : `People you may like to meet${client ? `, ${client}` : ""}`;
  const body = normalizeMessage([
    "Hi,",
    "",
    kind === "role"
      ? `Here are the people I would like you to consider for the ${roleTitle} role${client ? ` at ${client}` : ""}:`
      : "Here are some people I think you would like to meet:",
    link,
    "",
    [
      to ? "There is no account to make: the first time, the page asks for this email address." : "The page opens without signing in.",
      kind === "role" ? "It fills in as I put more people forward." : "",
      "What they told me about pay, notice, location and right to work is in their own words.",
    ].filter(Boolean).join(" "),
    "",
    "Let me know who you would like to meet.",
    "",
    recruiterName,
  ].join("\n"));
  const href = mailtoHref(recipient, subject, body) ?? mailtoSubjectOnly(recipient, subject);

  return (
    <>
      <div className="client-link-address">
        <label htmlFor={`${id}-link`} className="sr-only">Client link</label>
        <input id={`${id}-link`} className="field-input" value={link} readOnly onFocus={(event) => event.currentTarget.select()} />
        <CopyButton text={link} label="Copy link" className="btn-secondary" />
      </div>
      {to ? (
        <div className="client-link-share">
          <a href={href} className="btn-primary">Open in email to {to}</a>
        </div>
      ) : (
      <div className="client-link-share">
        <div>
          <label htmlFor={`${id}-to`} className="field-label">Client&rsquo;s email address (not saved)</label>
          <input id={`${id}-to`} type="email" className="field-input" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="hiring.manager@client.example" autoComplete="off" />
        </div>
        <a href={href} className="btn-primary">Open in email</a>
      </div>
      )}
    </>
  );
}
