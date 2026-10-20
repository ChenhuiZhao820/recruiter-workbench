import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Account email to the recruiter themself: a sign-up code, a password reset
// link, "you already have an account". Retrivr still sends nothing to
// candidates or clients. Delivery is Resend's HTTP API, configured by
// RESEND_API_KEY and MAIL_FROM (an address on a domain verified in Resend).
// Outside production, CAPTURE_TEST_MAIL_DIR writes each message to a file
// instead, so tests read codes without a mail provider.

export type Mail = { to: string; subject: string; text: string };

function testOutbox(): string | null {
  return process.env.NODE_ENV !== "production" && process.env.CAPTURE_TEST_MAIL_DIR ? process.env.CAPTURE_TEST_MAIL_DIR : null;
}

export function mailConfigured(): boolean {
  return Boolean(testOutbox() || (process.env.RESEND_API_KEY && process.env.MAIL_FROM));
}

export async function sendMail(mail: Mail): Promise<void> {
  const outbox = testOutbox();
  if (outbox) {
    await mkdir(outbox, { recursive: true });
    const name = `${Date.now()}-${createHash("sha256").update(mail.to + mail.subject + mail.text).digest("hex").slice(0, 12)}.json`;
    await writeFile(path.join(outbox, name), JSON.stringify(mail), { encoding: "utf8", flag: "wx" });
    return;
  }
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) throw new Error("Email is not set up on this server.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text }),
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Email could not be sent (${response.status}).`);
}
