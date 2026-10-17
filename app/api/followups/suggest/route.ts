import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { appOrigin, getSession } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { canUseFeature } from "@/lib/features";
import { getSettings } from "@/lib/settings";
import { firstName, normalizeMessage } from "@/lib/render";
import { bookingLinkFor } from "@/lib/booking";
import { recordUsage } from "@/lib/usage";
import { MIN_THEIR_REPLY, ReplyRefusedError, replyModel, replyMonthlyCap, suggestReply } from "@/lib/reply-model.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

// A suggested reply to a candidate who answered, from the message the
// recruiter pasted in. Only on a request from this app's own page, only for
// the signed-in account's own candidate, never from a read-only view (it
// spends), and capped per account per UTC month. Neither their message nor
// the suggestion is stored: usage records a count only.
export async function POST(request: Request) {
  if (request.headers.get("origin") !== appOrigin()) return fail(403, "This request did not come from the workbench.");
  if (!(await getSession())) return fail(401, "Sign in first.");
  const { user, owner, readOnly } = await getWorkspace();
  if (readOnly) return fail(403, "Return to your own workspace first.");
  if (!canUseFeature(user, "replySuggestions") || !canUseFeature(owner, "replySuggestions")) return fail(404, "Not found");
  if (!process.env.ANTHROPIC_API_KEY) return fail(503, "Suggestions are not set up on this server.");

  const body = (await request.json().catch(() => null)) as { candidateId?: unknown; theirReply?: unknown } | null;
  const candidateId = typeof body?.candidateId === "string" ? body.candidateId : "";
  const theirReply = typeof body?.theirReply === "string" ? normalizeMessage(body.theirReply) : "";
  if (theirReply.length < MIN_THEIR_REPLY) return fail(400, "Paste their reply first.");

  const candidate = await db.candidate.findFirst({
    where: { id: candidateId, role: { userId: user.id } },
    include: {
      role: true,
      person: { select: { doNotContact: true } },
      outreach: { orderBy: { sentAt: "desc" }, take: 1, select: { renderedBody: true } },
    },
  });
  if (!candidate) return fail(404, "That candidate could not be found.");
  if (candidate.person?.doNotContact) return fail(409, "This person is marked do not contact.");

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const used = await db.usageEvent.count({ where: { userId: user.id, kind: "reply_suggested", at: { gte: monthStart } } });
  if (used >= replyMonthlyCap()) return fail(429, "This month's suggested replies are used up. Write this one yourself.");

  const settings = await getSettings();
  try {
    const { text } = await suggestReply({
      recruiterName: settings.recruiterName ? firstName(settings.recruiterName) : "",
      candidateName: firstName(candidate.fullName),
      roleTitle: candidate.role.title,
      lastMessage: candidate.outreach[0]?.renderedBody ?? null,
      theirReply,
      bookingLink: bookingLinkFor(candidate, settings) || null,
      model: replyModel(),
    });
    await recordUsage(db, user.id, "reply_suggested", null, 1);
    return Response.json({ suggestion: normalizeMessage(text) }, { headers });
  } catch (error) {
    if (error instanceof ReplyRefusedError) return fail(422, "No suggestion for this one. Write it yourself.");
    if (error instanceof Anthropic.APIError) return fail(502, "The suggestion service could not be reached.");
    throw error;
  }
}
