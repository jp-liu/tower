#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This release verifier exposes CommonJS helpers consumed by its tests. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const projectRoot = path.join(__dirname, "..");
const REQUIRED_FILES = [
  "bin/tower.mjs",
  "bin/network.mjs",
  ".next/standalone/server.js",
  "prisma/schema.prisma",
  "scripts/link-embedded-packages.js",
  "scripts/run-migrations.ts",
  "scripts/migrations/0009-api-connections.ts",
  "scripts/migrations/0010-capability-targets.ts",
  "scripts/migrations/0011-cli-plugin-connections.ts",
  "scripts/migrations/0012-terminal-execution-targets.ts",
  "scripts/migrations/0013-assistant-sessions.ts",
  "packages/ai-sdk/package.json",
  "packages/ai-sdk/dist/index.js",
  "packages/ai-runtime/package.json",
  "packages/ai-runtime/dist/index.js",
  "packages/ai-runtime/dist/api-presets.generated.js",
  "packages/ai-provider-claude/package.json",
  "packages/ai-provider-claude/dist/index.js",
  "packages/ai-provider-claude/config.schema.json",
  "packages/ai-provider-codex/package.json",
  "packages/ai-provider-codex/dist/index.js",
  "packages/ai-provider-codex/config.schema.json",
  "packages/ai-provider-gemini/package.json",
  "packages/ai-provider-gemini/dist/index.js",
  "packages/ai-provider-gemini/config.schema.json",
  "docs/licenses/models.dev-MIT.md",
];
const REQUIRED_AI_RUNTIME_DEPENDENCIES = [
  "@ai-sdk/anthropic",
  "@ai-sdk/google",
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
  "@ai-sdk/provider",
  "ai",
];
const REQUIRED_EMBEDDED_RUNTIME_DEPENDENCIES = [
  ...REQUIRED_AI_RUNTIME_DEPENDENCIES,
  "ajv",
  "semver",
  "tar",
];
const REQUIRED_PREFIXES = ["skills/", "extensions/"];
const FORBIDDEN = [
  /^test-results\//,
  /^tests?\//,
  /(^|\/)(?:packages|extensions)\/(?:[^/]+\/)*tests?\//,
  /(^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)(?:vitest|playwright)\.config\.[cm]?[jt]s$/,
  /(^|\/)\.npmrc$/i,
  /(^|\/)(?:npm-token|auth-token|tokens?|credentials?|secrets?)(?:\.[^/]*)?$/i,
  /(^|\/)\.tower(?:-dev)?\//,
  /(^|\/)\.worktrees?\//,
  /(^|\/)\.cache\//,
  /(^|\/)staging\//,
  /(^|\/)(?:registry|keys?)\.json$/i,
  /(^|\/).*\.db(?:-wal|-shm)?$/,
  /(^|\/)(?:screenshots?|playwright-report)\//,
];

function assertReleasePackage(pack, pkg, runtimePkg) {
  const errors = [];
  const files = new Set(pack.files.map((entry) => entry.path));
  if (pack.name !== "@tower-org/cli" || pkg.name !== "@tower-org/cli") {
    errors.push(`expected package name @tower-org/cli, got manifest=${pkg.name} pack=${pack.name}`);
  }
  if (pack.version !== "0.3.0" || pkg.version !== "0.3.0") {
    errors.push(`expected @tower-org/cli@0.3.0, got manifest=${pkg.version} pack=${pack.version}`);
  }
  if (pkg.publishConfig?.access !== "public"
    || pkg.publishConfig?.registry !== "https://registry.npmjs.org/"
    || pkg.publishConfig?.provenance !== true) {
    errors.push("public scoped package must enforce npmjs registry, public access, and provenance");
  }
  const workspaceRuntimeDeps = Object.entries(pkg.dependencies || {})
    .filter(([, value]) => String(value).startsWith("workspace:"));
  if (workspaceRuntimeDeps.length) {
    errors.push(`production dependencies contain workspace protocols: ${workspaceRuntimeDeps.map(([name]) => name).join(", ")}`);
  }
  if (runtimePkg) {
    for (const dependency of REQUIRED_EMBEDDED_RUNTIME_DEPENDENCIES) {
      if (!runtimePkg.dependencies?.[dependency]) errors.push(`AI runtime dependency missing: ${dependency}`);
      if (!pkg.dependencies?.[dependency]) errors.push(`CLI dependency missing for embedded AI runtime: ${dependency}`);
    }
  }
  for (const file of REQUIRED_FILES) {
    if (!files.has(file)) errors.push(`missing required file: ${file}`);
  }
  for (const prefix of REQUIRED_PREFIXES) {
    if (![...files].some((file) => file.startsWith(prefix))) errors.push(`missing required tree: ${prefix}`);
  }
  const forbidden = [...files].filter((file) => FORBIDDEN.some((pattern) => pattern.test(file)));
  if (forbidden.length) errors.push(`forbidden files: ${forbidden.slice(0, 20).join(", ")}`);
  if (errors.length) throw new Error(`Release package canary failed:\n- ${errors.join("\n- ")}`);
  return { files: files.size, size: pack.size, unpackedSize: pack.unpackedSize };
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const runtimePkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "packages", "ai-runtime", "package.json"), "utf8"));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tower-pack-check-"));
  try {
    const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--pack-destination", temporary], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: path.join(temporary, "npm-cache") },
    });
    const pack = JSON.parse(output)[0];
    const result = assertReleasePackage(pack, pkg, runtimePkg);
    console.log(`[release:pack:check] ${pkg.name}@${pkg.version}: ${result.files} files, ${result.unpackedSize} bytes unpacked`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = {
  assertReleasePackage,
  FORBIDDEN,
  REQUIRED_AI_RUNTIME_DEPENDENCIES,
  REQUIRED_EMBEDDED_RUNTIME_DEPENDENCIES,
  REQUIRED_FILES,
};
if (require.main === module) main();
