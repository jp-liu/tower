#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Portable archive verifier. */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { isWindows, portablePlatformName } = require("./release-platform.js");

const EXPECTED_NODE = { minimum: "22.0.0", tested: ["22", "24"], knownIncompatible: [] };
const SUPPORTED = new Set(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "windows-x64"]);

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function walk(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(candidate));
    else files.push(candidate);
  }
  return files;
}

function validateLinks(root, files, errors) {
  const canonicalRoot = fs.realpathSync(root);
  for (const file of files) {
    if (!fs.lstatSync(file).isSymbolicLink()) continue;
    try {
      const resolved = fs.realpathSync(file);
      const relative = path.relative(canonicalRoot, resolved);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        errors.push(`dependency link escapes archive: ${path.relative(root, file)}`);
      }
    } catch (error) {
      errors.push(`broken dependency link: ${path.relative(root, file)} (${error.message})`);
    }
  }
}

function assertPortableRoot(root, runtime = { platform: process.platform, arch: process.arch }) {
  const errors = [];
  const manifestPath = path.join(root, "portable-manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("Portable canary failed: portable-manifest.json is missing");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const platform = portablePlatformName(runtime.platform);
  if (!SUPPORTED.has(`${manifest.platform}-${manifest.arch}`)) errors.push(`unsupported target ${manifest.platform}-${manifest.arch}`);
  if (manifest.platform !== platform || manifest.arch !== runtime.arch) {
    errors.push(`archive target ${manifest.platform}-${manifest.arch} does not match runner ${platform}-${runtime.arch}`);
  }
  if (JSON.stringify(manifest.node) !== JSON.stringify(EXPECTED_NODE)) errors.push(`invalid Node contract ${JSON.stringify(manifest.node)}`);
  if (!/^[0-9a-f]{40}$/.test(manifest.sourceCommit)) errors.push("source commit must be a full Git SHA");

  const packageRoot = path.join(root, ...manifest.packageRoot.split("/"));
  const required = [
    "LICENSE",
    manifest.towerEntry,
    manifest.mcpEntry,
    `${manifest.packageRoot}/.next/standalone/server.js`,
    `${manifest.packageRoot}/prisma/schema.prisma`,
    `${manifest.packageRoot}/node_modules/@prisma/client/LICENSE`,
    `${manifest.packageRoot}/node_modules/node-pty/LICENSE`,
    `${manifest.packageRoot}/node_modules/@vscode/ripgrep/LICENSE`,
  ];
  for (const relative of required) {
    if (!fs.existsSync(path.join(root, ...relative.split("/")))) errors.push(`missing ${relative}`);
  }
  for (const relative of ["README.md", "README.txt", "INSTALL.md", `${manifest.packageRoot}/README.md`, `${manifest.packageRoot}/README.zh.md`]) {
    if (fs.existsSync(path.join(root, ...relative.split("/")))) errors.push(`embedded installation documentation is not allowed: ${relative}`);
  }
  const allFiles = fs.existsSync(packageRoot) ? walk(path.join(root, "runtime")) : [];
  const normalized = allFiles.map((file) => file.split(path.sep).join("/"));
  const nativeChecks = {
    "generated Prisma Query Engine": /\/\.prisma\/client\/.*query_engine.*\.(?:node|dll|so|dylib)$/,
    "Prisma Schema Engine": /\/@prisma\/engines\/schema-engine(?:-|\.exe)/,
    "node-pty native addon": /\/node-pty\/(?:prebuilds\/[^/]+\/.*|build\/Release\/pty)\.node$/,
    "ripgrep binary": /\/@vscode\/ripgrep-[^/]+\/bin\/rg(?:\.exe)?$/,
    "Next ripgrep alias": /\/node_modules\/@vscode\/ripgrep-[0-9a-f]+(?:\/package\.json)?$/,
  };
  for (const [label, pattern] of Object.entries(nativeChecks)) {
    if (!normalized.some((file) => pattern.test(file))) errors.push(`missing ${label}`);
  }
  validateLinks(root, allFiles, errors);
  if (errors.length) throw new Error(`Portable canary failed:\n- ${errors.join("\n- ")}`);
  return { manifest, packageRoot, files: allFiles.length };
}

function main() {
  const root = option("--root");
  if (!root) throw new Error("Usage: node scripts/release-portable-canary.js --root DIR");
  const result = assertPortableRoot(path.resolve(root));
  const tower = path.join(path.resolve(root), ...result.manifest.towerEntry.split("/"));
  const output = isWindows()
    ? execFileSync("cmd.exe", ["/d", "/c", tower, "--version"], { encoding: "utf8" })
    : execFileSync(tower, ["--version"], { encoding: "utf8" });
  if (output.trim() !== `tower v${result.manifest.version}`) throw new Error(`Portable version mismatch: ${output.trim()}`);
  console.log(`[release:portable:check] ${result.manifest.platform}-${result.manifest.arch}: ${result.files} files, ${output.trim()}`);
}

module.exports = { EXPECTED_NODE, SUPPORTED, assertPortableRoot };
if (require.main === module) main();
