/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets the E2E suite run its own dev server without fighting the normal
  // dev server over .next. Unset in normal use.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
