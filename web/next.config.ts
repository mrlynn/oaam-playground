import type { NextConfig } from "next";

// One URL for the whole demo (./demo.sh): this app serves the inspector and
// proxies the other two, so the chat and the docs share its origin and header.
// The dashboard itself still never writes: /chat is the companion's own server.
const COMPANION_URL = process.env.COMPANION_URL ?? "http://127.0.0.1:8765";
const DOCS_URL = process.env.DOCS_URL ?? "http://127.0.0.1:3101"; // site/ built with SITE_MODE=demo

const nextConfig: NextConfig = {
  // node-oracledb is a server-only Node package; keep it out of the bundle.
  serverExternalPackages: ["oracledb"],
  async rewrites() {
    return [
      { source: "/chat", destination: `${COMPANION_URL}/` },
      { source: "/chat/:path*", destination: `${COMPANION_URL}/:path*` },
      { source: "/docs", destination: `${DOCS_URL}/docs/` },
      { source: "/docs/:path*", destination: `${DOCS_URL}/docs/:path*` },
    ];
  },
};

export default nextConfig;
