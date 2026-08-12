import type { NextConfig } from "next";

// The browser only ever talks to this Next.js server; API calls are
// proxied server-side to the backend so the session cookie stays
// first-party. BACKEND_URL is baked in at build time (Next resolves
// rewrite destinations when the routes manifest is built), so in Docker
// this must be a build ARG, not a runtime env var.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4100";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
