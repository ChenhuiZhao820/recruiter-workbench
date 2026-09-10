import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { appOrigin, getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { canUseExtension } from "@/lib/extension-access";
import { extensionFiles, extensionZip } from "@/lib/extension-package.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Vary": "Cookie" };

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to download the extension." }, { status: 401, headers });
  if (session.viewUserId && session.viewUserId !== session.user.id) {
    return NextResponse.json({ error: "Return to your own workspace before downloading the extension." }, { status: 403, headers });
  }
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { active: true, role: true, extensionAccess: { select: { activatedAt: true } } },
  });
  if (!user || !canUseExtension(user)) {
    return NextResponse.json({ error: "Activate extension access in Your account before downloading." }, { status: 403, headers });
  }
  try {
    const inputs = Object.fromEntries(await Promise.all(["manifest.json", "popup.html", "popup.css", "popup.js"].map(async (name) => [
      name, await readFile(path.join(process.cwd(), "extension", name), "utf8"),
    ])));
    const zip = extensionZip(extensionFiles(inputs, appOrigin(), { allowLoopback: true }));
    return new Response(new Uint8Array(zip), {
      headers: { ...headers, "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="capture-extension.zip"', "Content-Length": String(zip.length) },
    });
  } catch {
    return NextResponse.json({ error: "The extension package is unavailable. Please contact your administrator." }, { status: 503, headers });
  }
}
