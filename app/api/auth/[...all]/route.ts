import { NextResponse } from "next/server";
import { toNextJsHandler } from "better-auth/next-js";
import { betterAuthConfigured, getAuth } from "@/lib/better-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Only the provider round trip is reachable from a browser: starting a Google
// or Microsoft sign-in, and the provider's return. Everything else Better Auth
// offers over HTTP is closed here; the sign-up code is sent and checked by
// server actions (app/actions/signup.ts), and no Better Auth session survives
// the request that made it (lib/better-auth.ts).
const OPEN = new Set(["POST /sign-in/social", "GET /callback/google", "GET /callback/microsoft"]);

function allowed(request: Request) {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "").replace(/\/$/, "");
  return betterAuthConfigured() && OPEN.has(`${request.method} ${path}`);
}

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  return allowed(request) ? toNextJsHandler(getAuth()).GET(request) : notFound();
}

export async function POST(request: Request) {
  return allowed(request) ? toNextJsHandler(getAuth()).POST(request) : notFound();
}
