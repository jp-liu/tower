import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["node-pty", "ws", "@vscode/ripgrep"],
  productionBrowserSourceMaps: false,
};

export default nextConfig;
