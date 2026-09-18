import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node-oracledb is a server-only Node package; keep it out of the bundle.
  serverExternalPackages: ["oracledb"],
};

export default nextConfig;
