import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["node-pty", "ws"],
};

export default nextConfig;
