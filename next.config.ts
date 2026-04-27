import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["node-pty", "ws", "@vscode/ripgrep"],
  productionBrowserSourceMaps: false,
  outputFileTracingIncludes: {
    "/*": [
      "node_modules/node-pty/prebuilds/**/*",
      "node_modules/@vscode/ripgrep/bin/**/*",
    ],
  },
};

export default nextConfig;
