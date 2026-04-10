import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["node-pty", "ws", "@prisma/client"],
};

export default nextConfig;
