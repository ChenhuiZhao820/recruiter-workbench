/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets the E2E suite run its own dev server without fighting the normal
  // dev server over .next. Unset in normal use.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    // A screening carries a transcript (up to 60,000 characters) and an
    // optional CV of up to 4 MB in one submission.
    serverActions: { bodySizeLimit: "6mb" },
    outputFileTracingIncludes: {
      "/api/extension/download": ["./extension/manifest.json", "./extension/popup.html", "./extension/popup.css", "./extension/popup.js"],
    },
  },
  async headers() {
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
    ];
    // A CV is shown inside this site's own pages (the client's link and the
    // preview), so those three addresses may be framed by this site and no
    // other. Everything else may not be framed at all.
    const cvPaths = ["/s/:token/cv/:itemId", "/shortlists/:id/preview/cv/:itemId", "/api/people/:id/cv"];
    return [
      {
        source: "/:path((?!s/[^/]+/cv/|shortlists/[^/]+/preview/cv/|api/people/[^/]+/cv$).*)",
        headers: [...common, { key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" }],
      },
      ...cvPaths.map((source) => ({
        source,
        headers: [...common, { key: "X-Frame-Options", value: "SAMEORIGIN" }, { key: "Content-Security-Policy", value: "frame-ancestors 'self'" }],
      })),
    ];
  },
};

export default nextConfig;
