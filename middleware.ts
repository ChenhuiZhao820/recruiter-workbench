import { NextResponse, type NextRequest } from "next/server";
import { canonicalRedirect } from "@/lib/canonical-host.mjs";

// Next 14 checks a server action's origin by parsing the Origin header, and an
// opaque `Origin: null` (a sandboxed frame, a privacy extension, or any page
// whose referrer policy is no-referrer) makes that parse throw, so the post
// ends in a 500 rather than a refusal. A page route takes a POST only for a
// server action, so refuse here, before Next tries: an origin that is not a
// URL, or whose host is not the one this request was sent to - the same
// comparison Next makes. A post with no Origin at all is left to Next and to
// assertSameOrigin. API routes check their own callers (the extension posts
// from its own origin) and are not matched.
//
// Before that, a page asked for at another address than APP_ORIGIN - the
// former onrender.com one - goes to the same path at APP_ORIGIN
// (lib/canonical-host.mjs says why, and why /api is left alone).
export function middleware(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const moved = canonicalRedirect(process.env.APP_ORIGIN ?? "", host, request.nextUrl.pathname, request.nextUrl.search);
  if (moved) return NextResponse.redirect(moved, 308);
  if (request.method === "GET" || request.method === "HEAD") return NextResponse.next();
  const origin = request.headers.get("origin");
  if (origin === null) return NextResponse.next();
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    // Not a URL: "null" or something stranger.
  }
  if (originHost && host && originHost === host) return NextResponse.next();
  return new NextResponse("This request did not come from this site. Go back, reload the page and try again.", {
    status: 403,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const config = {
  matcher: ["/((?!api/|_next/).*)"],
};
