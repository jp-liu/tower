import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained build: traced deps land in `.next/standalone/node_modules/`,
  // so `npm i tower-studio -g` no longer re-downloads the dependency graph.
  output: "standalone",
  // Pin the workspace root — without this Next.js infers it from the nearest
  // lockfile and can wrongly pick a stray ~/package-lock.json in $HOME.
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ["node-pty", "ws", "@prisma/client", "@vscode/ripgrep"],
  productionBrowserSourceMaps: false,
};

export default nextConfig;
