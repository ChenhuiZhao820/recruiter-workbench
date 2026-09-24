import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeProfileUrl } from "@/lib/urls";
import { memberIdOrNull } from "@/lib/linkedin";
import { corsHeaders } from "@/lib/capture";
import { hashToken } from "@/lib/auth-crypto";
import { canUseExtension } from "@/lib/extension-access";
import { revalidatePath } from "next/cache";
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
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function authorize(request: Request) {
  const token = request.headers.get("x-capture-token");
  if (!token || !/^[A-Za-z0-9_-]{24,128}$/.test(token)) return null;
  const settings = await db.settings.findUnique({
    where: { captureTokenHash: hashToken(token) },
    select: { user: { select: { id: true, email: true, name: true, active: true, role: true, extensionAccess: { select: { activatedAt: true } } } } },
  });
  return settings && canUseExtension(settings.user) ? settings.user : null;
}

function denied(request: Request) {
  return NextResponse.json(
    { error: "Capture key missing or revoked, account disabled, or extension activation required. Sign in, check extension activation on your Account page, and generate a new key in Settings." },
    { status: 401, headers: corsHeaders(request.headers.get("origin")) }
  );
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

  return NextResponse.json(
    {
      account: { id: account.id, email: account.email, name: account.name },
      roles,
      // What this deployment would hand out if the extension were downloaded
      // now. Chrome never updates an extension loaded by hand, so the only way
      // an old copy learns it is old is by asking.
      extension: { version: await packagedVersion() },
      ...(asked ? { existing } : {}),
    },
    { headers: cors }
  );
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

  const candidate = await db.candidate.create({
    data: {
      role: { connect: { id: roleId, userId: account.id, status: "open" } },
      fullName,
      profileUrl,
      headline: text(body.headline) || null,
      // LinkedIn's own member id, read from the profile the extension was
      // looking at. Only stored when it looks like one; it exists to open
      // LinkedIn's message box later, never to identify anyone elsewhere.
      memberId: memberIdOrNull(text(body.memberId)),
      notes: text(body.notes) || null,
    },
    select: { id: true, fullName: true },
  });

  revalidatePath(`/roles/${roleId}`);
  revalidatePath("/");

  const sameName = await db.candidate.count({ where: { roleId, role: { userId: account.id }, fullName } });
  return NextResponse.json(
    {
      ok: true,
      candidateId: candidate.id,
      fullName: candidate.fullName,
      warning:
        sameName > 1
          ? `This role already had someone called ${fullName}. Check you have not saved the same person twice.`
          : null,
    },
    { status: 201, headers: cors }
  );
}
