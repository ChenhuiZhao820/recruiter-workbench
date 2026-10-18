import { NextResponse, type NextRequest } from "next/server";

// Next 14 checks a server action's origin by parsing the Origin header, and an
// opaque `Origin: null` (a sandboxed frame, a privacy extension, or any page
// whose referrer policy is no-referrer) makes that parse throw, so the post
// ends in a 500 rather than a refusal. A page route takes a POST only for a
// server action, so refuse here, before Next tries: an origin that is not a
// URL, or whose host is not the one this request was sent to - the same
// comparison Next makes. A post with no Origin at all is left to Next and to
// assertSameOrigin. API routes check their own callers (the extension posts
// from its own origin) and are not matched.
export function middleware(request: NextRequest) {
  if (request.method === "GET" || request.method === "HEAD") return NextResponse.next();
  const origin = request.headers.get("origin");
  if (origin === null) return NextResponse.next();
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
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
