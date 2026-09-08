import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeProfileUrl } from "@/lib/urls";
import { corsHeaders } from "@/lib/capture";
import { hashToken } from "@/lib/auth-crypto";
import { revalidatePath } from "next/cache";

// The browser extension's one endpoint. It does exactly what the "Add
// candidate" form does, including the same URL normalisation and the same
// duplicate guard, so a one-click save cannot create records the form would
// have refused. Nothing here talks to LinkedIn: the extension reads the page
// the recruiter already has open, and only when they click it.

export const dynamic = "force-dynamic";

type CaptureBody = {
  roleId?: unknown;
  profileUrl?: unknown;
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
    select: { user: { select: { id: true, email: true, name: true, active: true } } },
  });
  return settings?.user.active ? settings.user : null;
}

function denied(request: Request) {
  return NextResponse.json(
    { error: "Capture key missing, revoked or account disabled. Sign in and generate a new key in Settings." },
    { status: 401, headers: corsHeaders(request.headers.get("origin")) }
  );
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

// Lists the roles a captured profile can be filed against.
export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  const account = await authorize(request);
  if (!account) return denied(request);

  const roles = await db.role.findMany({
    where: { userId: account.id, status: "open" },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, client: true },
  });
  return NextResponse.json({ account: { id: account.id, email: account.email, name: account.name }, roles }, { headers: cors });
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
