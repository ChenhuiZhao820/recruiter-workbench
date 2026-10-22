import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeProfileUrl } from "@/lib/urls";
import { memberIdOrNull } from "@/lib/linkedin";
import { corsHeaders } from "@/lib/capture";
import { authorizeCapture as authorize, captureDenied as denied } from "@/lib/capture-auth";
import { revalidatePath } from "next/cache";
import { findOrCreatePerson, isSuppressed } from "@/lib/people";
import { canonicalProfileUrl, cleanEmail } from "@/lib/person-keys.mjs";
import { canUseFeature } from "@/lib/features";
import { emailAllowance } from "@/lib/email-finder";
import { enrowKey } from "@/lib/enrow-core.mjs";
import { accountTierLabels, getAccountTier } from "@/lib/account-tiers";
import { readFile } from "node:fs/promises";
import path from "node:path";

// The browser extension's one endpoint. It does exactly what the "Add
// candidate" form does, including the same URL normalisation and the same
// duplicate guard, so a one-click save cannot create records the form would
// have refused. Nothing here talks to LinkedIn: the extension reads the page
// the recruiter already has open, and only when they click it.

export const dynamic = "force-dynamic";

type CaptureBody = {
  roleId?: unknown;
  profileUrl?: unknown;
  memberId?: unknown;
  fullName?: unknown;
  headline?: unknown;
  notes?: unknown;
  email?: unknown;
  emailFound?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

// Lists the roles a captured profile can be filed against, and - when the
// extension asks about one - whether this account already has that person.
// Knowing beforehand is the difference between a considered second look and a
// duplicate discovered weeks later. The lookup reads this account's own
// records only; it never reaches LinkedIn.
export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  const account = await authorize(request);
  if (!account) return denied(request);

  const roles = await db.role.findMany({
    where: { userId: account.id, status: "open" },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, client: true },
  });

  // Normalised the same way a save is, so "already saved" means the same thing
  // here as the duplicate guard below means.
  const asked = normalizeProfileUrl(new URL(request.url).searchParams.get("profileUrl"));
  const existing = asked
    ? await db.candidate.findFirst({
        where: { profileUrl: asked, role: { userId: account.id } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          fullName: true,
          stage: true,
          createdAt: true,
          role: { select: { id: true, title: true, client: true, status: true } },
        },
      })
    : null;

  // The person behind this profile, if this account already has them, and
  // whether the profile was deleted before. Both are this account's own
  // records; the extension ignores fields it does not know.
  const canonical = canonicalProfileUrl(asked);
  const person = canonical
    ? await db.person.findUnique({
        where: { userId_profileUrl: { userId: account.id, profileUrl: canonical } },
        select: {
          id: true,
          email: true,
          doNotContact: true,
          factsConfirmedAt: true,
          candidates: { select: { role: { select: { id: true, title: true } } } },
        },
      })
    : null;
  const suppressed = asked ? await isSuppressed(db, account.id, { profileUrl: asked }) : false;

  return NextResponse.json(
    {
      // The plan as the workbench names it, shown beside the name in the panel.
      account: { id: account.id, email: account.email, name: account.name, plan: accountTierLabels[getAccountTier(account)] },
      roles,
      // What this deployment would hand out if the extension were downloaded
      // now. Chrome never updates an extension loaded by hand, so the only way
      // an old copy learns it is old is by asking.
      extension: { version: await packagedVersion() },
      // The email finder's searches left, when this account's plan has it
      // and this server can search; null leaves Find email out of the panel.
      emailFinder: canUseFeature(account, "emailFinder") && enrowKey() ? finderCount(await emailAllowance(account)) : null,
      ...(asked
        ? {
            existing,
            person: person
              ? {
                  id: person.id,
                  email: person.email,
                  doNotContact: person.doNotContact,
                  factsConfirmedAt: person.factsConfirmedAt,
                  roles: person.candidates.map((candidate) => candidate.role),
                }
              : null,
            suppressed,
          }
        : {}),
    },
    { headers: cors }
  );
}

// The searches left and the plan's number of them, nothing more.
function finderCount({ remaining, quota, trial }: { remaining: number; quota: number; trial: boolean }) {
  return { remaining, quota, trial };
}

// Read from the same folder the download endpoint packages, so the number the
// extension is compared against is the number it would actually receive.
async function packagedVersion(): Promise<string | null> {
  try {
    const manifest = JSON.parse(await readFile(path.join(process.cwd(), "extension", "manifest.json"), "utf8"));
    return typeof manifest.version === "string" && /^[0-9.]{1,24}$/.test(manifest.version) ? manifest.version : null;
  } catch {
    // Not worth failing a capture over; the extension simply says nothing.
    return null;
  }
}

export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  const account = await authorize(request);
  if (!account) return denied(request);

  let body: CaptureBody;
  try {
    const raw = await request.text();
    if (raw.length > 32768) throw new Error("Too large");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected object");
    body = parsed;
  } catch {
    return NextResponse.json({ error: "Expected a JSON object of at most 32 KB." }, { status: 400, headers: cors });
  }

  const roleId = text(body.roleId);
  const fullName = text(body.fullName);
  if (!roleId) {
    return NextResponse.json({ error: "Pick a role first." }, { status: 400, headers: cors });
  }
  if (!fullName) {
    return NextResponse.json(
      { error: "No name found on the page. Type one in and save again." },
      { status: 400, headers: cors }
    );
  }

  const role = await db.role.findFirst({ where: { id: roleId, userId: account.id, status: "open" }, select: { id: true } });
  if (!role) {
    return NextResponse.json({ error: "That role no longer exists or is not open in your workspace." }, { status: 404, headers: cors });
  }

  const profileUrl = normalizeProfileUrl(text(body.profileUrl));

  // One click makes an accidental second save far easier than the form did,
  // so the duplicate guard matters more here, not less.
  if (profileUrl) {
    const existing = await db.candidate.findFirst({
      where: { roleId, role: { userId: account.id }, profileUrl },
      select: { fullName: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: `${existing.fullName} is already on this role with that profile link.` },
        { status: 409, headers: cors }
      );
    }
  }

  // An email from the panel, found by Find email (saved as found while
  // unchanged) or typed. It fills an empty address on the person and never
  // replaces one this account already keeps.
  const typedEmail = text(body.email);
  const email = typedEmail ? cleanEmail(typedEmail) : null;
  if (typedEmail && !email) {
    return NextResponse.json({ error: "That does not look like an email address. Nothing was saved." }, { status: 400, headers: cors });
  }

  const headline = text(body.headline) || null;
  // LinkedIn's own member id, read from the profile the extension was
  // looking at. Only stored when it looks like one; it opens LinkedIn's
  // message box later and recognises the same person across roles in this
  // account, never anyone elsewhere.
  const memberId = memberIdOrNull(text(body.memberId));
  const suppressed = await isSuppressed(db, account.id, { profileUrl, memberId });
  const { candidate, person } = await db.$transaction(async (tx) => {
    const person = await findOrCreatePerson(tx, account.id, { fullName, profileUrl, memberId, headline });
    if (email && !person.email) {
      await tx.person.update({
        where: { id: person.id, userId: account.id },
        data: { email, emailSource: body.emailFound === true ? "finder" : "manual", emailConsentAt: null },
      });
    }
    const candidate = await tx.candidate.create({
      data: {
        role: { connect: { id: roleId, userId: account.id, status: "open" } },
        person: { connect: { id: person.id } },
        fullName,
        profileUrl,
        headline,
        memberId,
        notes: text(body.notes) || null,
      },
      select: { id: true, fullName: true },
    });
    return { candidate, person };
  });

  revalidatePath(`/roles/${roleId}`);
  revalidatePath("/");

  const sameName = await db.candidate.count({ where: { roleId, role: { userId: account.id }, fullName } });
  return NextResponse.json(
    {
      ok: true,
      candidateId: candidate.id,
      fullName: candidate.fullName,
      warning: person.doNotContact
        ? `${fullName} is marked do not contact. Check before reaching out.`
        : suppressed
          ? "This profile was deleted from your workspace before. Check they have agreed to be contacted again."
          : sameName > 1
            ? `This role already had someone called ${fullName}. Check you have not saved the same person twice.`
            : null,
    },
    { status: 201, headers: cors }
  );
}
