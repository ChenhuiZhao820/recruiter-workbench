"use client";

import { useId, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { mailtoHref, mailtoSubjectOnly } from "@/lib/client-email";
import { normalizeMessage } from "@/lib/render";

// The address of a role's client link, and the one way Capture helps send it:
// an email the recruiter opens in their own app. The recipient field has no
// form name, so it is never submitted or stored.
export function ClientLinkShare({ link, roleTitle, client, recruiterName }: {
  link: string;
  roleTitle: string;
  client: string | null;
  recruiterName: string;
}) {
  const id = useId();
  const [recipient, setRecipient] = useState("");
  const subject = `Candidates for ${roleTitle}`;
  const body = normalizeMessage([
    "Hi,",
    "",
    `Here are the people I would like you to consider for the ${roleTitle} role${client ? ` at ${client}` : ""}:`,
    link,
    "",
    "The page opens without signing in, and it fills in as I put more people forward. What they told me about pay, notice, location and right to work is in their own words.",
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
      <div className="client-link-share">
        <div>
          <label htmlFor={`${id}-to`} className="field-label">Client&rsquo;s email address (not saved)</label>
          <input id={`${id}-to`} type="email" className="field-input" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="hiring.manager@client.example" autoComplete="off" />
        </div>
        <a href={href} className="btn-primary">Open in email</a>
      </div>
    </>
  );
}
