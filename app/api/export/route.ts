import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canUseFeature } from "@/lib/features";
import { buildExport, isExportTable, toCsv } from "@/lib/export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Vary": "Cookie" };

// A recruiter's own data, whole. Only from their own workspace: a read-only
// Admin view of someone else's workspace cannot take a copy of it.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to export your data." }, { status: 401, headers });
  if (session.viewUserId && session.viewUserId !== session.user.id) {
    return NextResponse.json({ error: "Return to your own workspace before exporting." }, { status: 403, headers });
  }
  if (!canUseFeature(session.user, "export")) {
    return NextResponse.json({ error: "Export is not available on this account." }, { status: 404, headers });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "json";
  const date = new Date().toISOString().slice(0, 10);
  const data = await buildExport(session.user.id);

  if (format === "json") {
    const body = JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2);
    return new Response(body, {
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="capture-export-${date}.json"`,
      },
    });
  }
  if (format === "csv") {
    const table = url.searchParams.get("table") ?? "";
    if (!isExportTable(table)) return NextResponse.json({ error: "Choose a table to export." }, { status: 400, headers });
    // The byte order mark makes Excel read the file as UTF-8.
    return new Response(`﻿${toCsv(data[table])}`, {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="capture-${table}-${date}.csv"`,
      },
    });
  }
  return NextResponse.json({ error: "Choose JSON or CSV." }, { status: 400, headers });
}
