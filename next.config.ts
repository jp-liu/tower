import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["node-pty", "ws", "@prisma/client", "@vscode/ripgrep"],
  productionBrowserSourceMaps: false,
};

export default nextConfig;
