#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This published postinstall helper must run as CommonJS in consumer installs. */
const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.join(__dirname, "..");
const EMBEDDED_PACKAGES = {
  "@tower-org/ai-sdk": "packages/ai-sdk",
  "@tower-org/ai-runtime": "packages/ai-runtime",
  "@tower-org/ai-provider-claude": "packages/ai-provider-claude",
  "@tower-org/ai-provider-codex": "packages/ai-provider-codex",
  "@tower-org/ai-provider-gemini": "packages/ai-provider-gemini",
};

function linkEmbeddedPackages(root = packageRoot) {
  for (const [packageName, relativeTarget] of Object.entries(EMBEDDED_PACKAGES)) {
    const target = path.join(root, relativeTarget);
    const link = path.join(root, "node_modules", ...packageName.split("/"));
    if (!fs.existsSync(target)) throw new Error(`Embedded package missing: ${packageName} (${target})`);

    if (fs.existsSync(link)) {
      if (fs.realpathSync(link) !== fs.realpathSync(target)) {
        throw new Error(`Refusing to replace existing package path: ${link}`);
      }
      continue;
    }

    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, "junction");
    console.log(`[link-embedded-packages] ${packageName} -> ${relativeTarget}`);
  }
}

module.exports = { EMBEDDED_PACKAGES, linkEmbeddedPackages };
if (require.main === module) linkEmbeddedPackages();
