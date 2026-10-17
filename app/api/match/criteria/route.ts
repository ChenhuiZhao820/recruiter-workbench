import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordUsage } from "@/lib/usage";
import { matchReadsLeft, nextMonthStart, writableMatchAccount } from "@/lib/match";
import { MAX_BRIEF_CHARS, MAX_INSTRUCTION_CHARS, criteriaIsEmpty, decodeCriteria, describeChanges, encodeCriteria } from "@/lib/match-core.mjs";
import { MatchRefusedError, MatchShapeError, matchModel, readCriteria } from "@/lib/match-model.mjs";

export const dynamic = "force-dynamic";

// POST { brief } reads a brief into criteria. POST { criteria, instruction }
// changes the criteria by one sentence. Either way only the recruiter's own
// words go to the model, never a person from the database, and neither the
// brief nor the sentence is stored.
export async function POST(request: Request) {
  const account = await writableMatchAccount(request);
  if ("error" in account) return account.error;
  const { user } = account;

  let body: { brief?: unknown; criteria?: unknown; instruction?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
  }
  const adjusting = typeof body.criteria === "string";
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  const current = adjusting ? decodeCriteria(body.criteria as string) : null;
  if (adjusting) {
    if (!current) return NextResponse.json({ error: "Those criteria could not be read. Start the match again." }, { status: 400 });
    if (!instruction) return NextResponse.json({ error: "Say what to change, for example “must have done B2B SaaS”." }, { status: 400 });
    if (instruction.length > MAX_INSTRUCTION_CHARS) return NextResponse.json({ error: `Keep it to ${MAX_INSTRUCTION_CHARS} characters.` }, { status: 400 });
  } else {
    if (brief.length < 20) return NextResponse.json({ error: "Paste the job description, or a few lines about the role, first." }, { status: 400 });
    if (brief.length > MAX_BRIEF_CHARS) return NextResponse.json({ error: `That is longer than ${MAX_BRIEF_CHARS.toLocaleString("en-GB")} characters. Paste the description and the client's must-haves only.` }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Instant Match is not set up on this server yet: it needs an AI key. The filters on People still work." }, { status: 503 });
  }
  const left = await matchReadsLeft(user.id);
  if (left <= 0) {
    const resets = nextMonthStart().toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
    return NextResponse.json({ error: `You have used this month’s briefs. It resets on ${resets}. Your current criteria still work: edit them by hand.` }, { status: 429 });
  }

  let criteria;
  try {
    criteria = await readCriteria({ apiKey: process.env.ANTHROPIC_API_KEY, model: matchModel(), brief, criteria: current, instruction });
  } catch (error) {
    if (error instanceof MatchRefusedError) return NextResponse.json({ error: "Capture could not read that brief. Try trimming it to the role and the client’s requirements." }, { status: 422 });
    if (error instanceof MatchShapeError) return NextResponse.json({ error: "That did not come back in a shape Capture could use. Try again." }, { status: 502 });
    return NextResponse.json({ error: "The matching service could not be reached. Try again in a moment." }, { status: 502 });
  }
  if (criteriaIsEmpty(criteria)) {
    return NextResponse.json({ error: "Nothing to match on came out of that. Add the skills or title the role needs." }, { status: 422 });
  }

  await recordUsage(db, user.id, adjusting ? "match_adjusted" : "match_brief_read");
  return NextResponse.json({
    criteria: encodeCriteria(criteria),
    changes: current ? describeChanges(current, criteria) : [],
    left: left - 1,
  });
}
