#!/usr/bin/env node
/**
 * Turbopack may rewrite external package names with content hashes
 * (for example `@prisma/client-<hash>` or `node-pty-<hash>`).
 * This script scans the build output and creates symlinks so Node.js
 * can resolve those hashed names at runtime after global install.
 */
const fs = require("fs");
const path = require("path");

const packageRoot = path.join(__dirname, "..");
const serverDir = path.join(packageRoot, ".next", "server");
const supportedPackages = [
  "@prisma/client",
  "node-pty",
  "@vscode/ripgrep",
  "ws",
];

if (!fs.existsSync(serverDir)) {
  process.exit(0);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectJsFiles(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(full, result);
    } else if (entry.name.endsWith(".js")) {
      result.push(full);
    }
  }
  return result;
}

function detectHashedReferences(files) {
  const matches = new Map();

  for (const pkg of supportedPackages) {
    matches.set(pkg, new Set());
  }

  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    for (const pkg of supportedPackages) {
      const pattern = new RegExp(`${escapeRegExp(pkg)}-([0-9a-f]+)`, "g");
      let match;
      while ((match = pattern.exec(content)) !== null) {
        matches.get(pkg).add(match[1]);
      }
    }
  }

  return matches;
}

function getPackageParts(pkg) {
  if (pkg.startsWith("@")) {
    const [scope, name] = pkg.split("/");
    return { scope, name };
  }

  return { scope: null, name: pkg };
}

function getVisiblePackageDir(pkg) {
  const { scope, name } = getPackageParts(pkg);
  return scope
    ? path.join(packageRoot, "node_modules", scope, name)
    : path.join(packageRoot, "node_modules", name);
}

function collectAliasTargets(pkg) {
  const pkgJsonPath = require.resolve(`${pkg}/package.json`, { paths: [packageRoot] });
  const realPackageDir = path.dirname(pkgJsonPath);
  const visiblePackageDir = getVisiblePackageDir(pkg);
  const candidates = new Map();

  if (fs.existsSync(visiblePackageDir)) {
    candidates.set(visiblePackageDir, path.dirname(visiblePackageDir));
  }

  candidates.set(realPackageDir, path.dirname(realPackageDir));

  return {
    targetDir: visiblePackageDir,
    aliasBaseDirs: [...candidates.values()],
    packageName: getPackageParts(pkg).name,
  };
}

function linkHashedPackage(pkg, hash) {
  let paths;
  try {
    paths = collectAliasTargets(pkg);
  } catch (error) {
    console.warn(`[link-prisma] Cannot resolve ${pkg}: ${error.message}`);
    return;
  }

  if (!fs.existsSync(paths.targetDir)) {
    console.warn(`[link-prisma] Target package directory missing for ${pkg}, skipping`);
    return;
  }

  const linkName = `${paths.packageName}-${hash}`;

  for (const aliasBaseDir of paths.aliasBaseDirs) {
    const linkPath = path.join(aliasBaseDir, linkName);
    if (fs.existsSync(linkPath)) {
      console.log(`[link-prisma] ${pkg}-${hash} already exists in ${aliasBaseDir}`);
      continue;
    }

    try {
      fs.symlinkSync(paths.targetDir, linkPath, "junction");
      console.log(`[link-prisma] Linked ${pkg}-${hash} -> ${pkg} in ${aliasBaseDir}`);
    } catch (error) {
      console.warn(
        `[link-prisma] Failed to create symlink for ${pkg}-${hash} in ${aliasBaseDir}: ${error.message}`
      );
    }
  }
}

const jsFiles = collectJsFiles(serverDir);
const references = detectHashedReferences(jsFiles);
let createdAny = false;

for (const [pkg, hashes] of references.entries()) {
  for (const hash of hashes) {
    createdAny = true;
    linkHashedPackage(pkg, hash);
  }
}

if (!createdAny) {
  console.log("[link-prisma] No hashed external package references found, skipping");
}
