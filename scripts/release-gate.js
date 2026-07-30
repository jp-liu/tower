#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This release verifier is a CommonJS entrypoint. */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const projectRoot = path.join(__dirname, "..");
const EXPECTED_REGISTRY = "https://registry.npmjs.org/";
const EXPECTED_REPOSITORY = "git+https://github.com/tower-org/tower.git";
const EXPECTED_PACKAGES = new Map([
  ["package.json", { name: "@tower-org/cli", version: "0.3.1", private: false }],
  ["packages/ai-sdk/package.json", { name: "@tower-org/ai-sdk", version: "0.1.0", private: true }],
  ["packages/ai-runtime/package.json", { name: "@tower-org/ai-runtime", version: "0.1.0", private: true }],
  ["packages/ai-provider-claude/package.json", { name: "@tower-org/ai-provider-claude", version: "0.1.0", private: true }],
  ["packages/ai-provider-codex/package.json", { name: "@tower-org/ai-provider-codex", version: "0.1.0", private: true }],
  ["packages/ai-provider-gemini/package.json", { name: "@tower-org/ai-provider-gemini", version: "0.1.0", private: true }],
  ["extensions/cli-providers/qwen-code/package.json", { name: "tower-extension-qwen-code", version: "0.1.0", private: true }],
]);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function assertReleaseConfiguration(options = {}) {
  const errors = [];
  const registry = options.registry ?? EXPECTED_REGISTRY;
  if (registry !== EXPECTED_REGISTRY) {
    errors.push(`release registry must be ${EXPECTED_REGISTRY}, got ${registry}`);
  }

  for (const [relativePath, expected] of EXPECTED_PACKAGES) {
    const manifest = readJson(relativePath);
    if (manifest.name !== expected.name) {
      errors.push(`${relativePath} name must be ${expected.name}, got ${manifest.name}`);
    }
    if (manifest.version !== expected.version) {
      errors.push(`${relativePath} version must be ${expected.version}, got ${manifest.version}`);
    }
    if (expected.private && manifest.private !== true) {
      errors.push(`${relativePath} must remain private`);
    }
    if (!expected.private && manifest.private === true) {
      errors.push(`${relativePath} must be publishable`);
    }
    if (manifest.repository?.url !== EXPECTED_REPOSITORY) {
      errors.push(`${relativePath} repository must be ${EXPECTED_REPOSITORY}`);
    }
    if (manifest.homepage?.startsWith("https://github.com/tower-org/tower") !== true) {
      errors.push(`${relativePath} homepage must use the tower-org/tower repository`);
    }
    if (manifest.bugs?.url !== "https://github.com/tower-org/tower/issues") {
      errors.push(`${relativePath} bugs URL must use the tower-org/tower repository`);
    }
  }

  const root = readJson("package.json");
  if (JSON.stringify(root.bin) !== JSON.stringify({ tower: "bin/tower.mjs" })) {
    errors.push("package.json must expose only the stable tower binary");
  }
  if (root.publishConfig?.access !== "public") {
    errors.push("package.json publishConfig.access must be public");
  }
  if (root.publishConfig?.registry !== EXPECTED_REGISTRY) {
    errors.push(`package.json publishConfig.registry must be ${EXPECTED_REGISTRY}`);
  }
  if (root.publishConfig?.provenance !== true) {
    errors.push("package.json publishConfig.provenance must be true");
  }

  const legacyScope = "@" + "tower/";
  const activePaths = [
    "package.json",
    "pnpm-lock.yaml",
    "packages",
    "extensions",
    "src",
    "scripts",
    "tests",
    ".github",
    "vitest.config.ts",
    "next.config.ts",
  ];
  try {
    const matches = execFileSync(
      "git",
      ["grep", "-n", "-I", legacyScope, "--", ...activePaths],
      { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (matches) errors.push(`legacy npm scope remains in active files:\n${matches}`);
  } catch (error) {
    if (error.status !== 1) errors.push(`could not scan for the legacy npm scope: ${error.message}`);
  }

  if (errors.length) throw new Error(`Release configuration gate failed:\n- ${errors.join("\n- ")}`);
  return { packageName: root.name, version: root.version, registry };
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const result = assertReleaseConfiguration({ registry: option("--registry") });
  console.log(`[release:gate] ${result.packageName}@${result.version} -> ${result.registry}`);
}

module.exports = { assertReleaseConfiguration, EXPECTED_PACKAGES, EXPECTED_REGISTRY };
if (require.main === module) main();
