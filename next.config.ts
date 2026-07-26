import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained build: traced deps land in `.next/standalone/node_modules/`,
  // so `npm i -g @tower-org/cli` no longer re-downloads the dependency graph.
  output: "standalone",
  // Dev and prod must not share a build dir, or `pnpm dev` clobbers the prod
  // `.next/standalone` that `pnpm start` (bin/tower.mjs) loads. The `dev` script
  // sets NEXT_DISTDIR=.next-dev; prod build/start keep the default `.next`.
  distDir: process.env.NEXT_DISTDIR || ".next",
  // Pin the workspace root — without this Next.js infers it from the nearest
  // lockfile and can wrongly pick a stray ~/package-lock.json in $HOME.
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ["node-pty", "ws", "@prisma/client", "@vscode/ripgrep"],
  productionBrowserSourceMaps: false,
};

export default nextConfig;
