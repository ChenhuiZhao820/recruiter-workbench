import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordUsage } from "@/lib/usage";
import { writableMatchAccount } from "@/lib/match";
import { NOT_FIT_REASONS } from "@/lib/match-core.mjs";

export const dynamic = "force-dynamic";

// Counts only: which way out of a disappointing match recruiters take. A kind
// and at most a small number, never a person, a brief or a criterion.
const KINDS = ["match_loosened", "match_not_fit", "match_handoff"] as const;

export async function POST(request: Request) {
  const account = await writableMatchAccount(request);
  if ("error" in account) return account.error;
  const body = await request.json().catch(() => ({}));
  const kind = KINDS.find((item) => item === body?.kind);
  if (!kind) return NextResponse.json({ error: "Unknown event." }, { status: 400 });
  const value = kind === "match_not_fit" ? NOT_FIT_REASONS.indexOf(String(body.reason)) : null;
  await recordUsage(db, account.user.id, kind, value === -1 ? null : value);
  return new NextResponse(null, { status: 204 });
}
