/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets the E2E suite run its own dev server without fighting the normal
  // dev server over .next. Unset in normal use.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    outputFileTracingIncludes: {
      "/api/extension/download": ["./extension/manifest.json", "./extension/popup.html", "./extension/popup.css", "./extension/popup.js"],
    },
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
      ],
    }];
  },
};

export default nextConfig;
