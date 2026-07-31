#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This build helper is invoked directly by Node as CommonJS. */
/**
 * Five jobs on `.next/standalone/` before publish:
 *
 *   1. Flatten pnpm symlinks.
 *      pnpm builds `node_modules/` as symlinks into `.pnpm/<pkg>@<ver>/...`.
 *      `npm pack` ignores those symlinks → user gets `.pnpm/` real files but
 *      no top-level `next/`, `react/`, etc. → `Cannot find module 'next'`.
 *      Dereference symlinks into real directories, then delete `.pnpm/`.
 *
 *   2. Native-binary prune.
 *      Next.js standalone copies traced deps — including build-machine native
 *      binaries (Prisma engine, node-pty prebuilds, ripgrep, sharp). They
 *      won't match a user on different OS/arch. Drop them; postinstall reinstalls
 *      per-platform via the package's `dependencies`.
 *
 *   3. Workspace cruft.
 *      Next.js standalone helpfully copies the whole trace root (AGENTS.md,
 *      docs/, .claude/, etc.). Keep only what the runtime loads.
 *
 *   4. Lazy-installed extension assets.
 *      `public/vs/` (Monaco editor, ~15MB) is installed on demand via the
 *      extension UI. Don't ship the build-machine copy.
 *
 *   5. Output-file trace manifests.
 *      Next uses `.nft.json` files to assemble the standalone directory. The
 *      minimal server does not read them after assembly, and dynamic host-file
 *      access can make the manifests much larger than the application itself.
 */
const fs = require("fs");
const path = require("path");

const standaloneDir = path.join(__dirname, "..", ".next", "standalone");
const standaloneNm = path.join(standaloneDir, "node_modules");

if (!fs.existsSync(standaloneDir)) {
  console.log("[prune-standalone] No .next/standalone/ — skipping");
  process.exit(0);
}

// --- 1. Flatten pnpm symlinks into a plain npm-style node_modules ---
// pnpm layout: node_modules/<pkg> → ../.pnpm/<pkg-key>/node_modules/<pkg>
// Top-level symlinks AND all transitive packages live under .pnpm/. `npm pack`
// ignores symlinks, and Next.js needs its transitive peer deps
// (@swc/helpers, styled-jsx, etc.) at the top level. Walk .pnpm/ and copy
// every package to the flat top-level location, then drop .pnpm/.
function flattenPnpmStore(nmDir) {
  const pnpmDir = path.join(nmDir, ".pnpm");
  if (!fs.existsSync(pnpmDir)) return 0;

  let copied = 0;
  for (const pkgKey of fs.readdirSync(pnpmDir)) {
    // Each .pnpm entry shapes like "next@16.2.1_xxx" or "@swc+helpers@0.5.15".
    const innerNm = path.join(pnpmDir, pkgKey, "node_modules");
    if (!fs.existsSync(innerNm)) continue;

    // pnpm key shapes:
    //   "next@16.2.1_@babel+core@7.29.0_..."  (peer deps appended after '_')
    //   "@swc+helpers@0.5.15"                  (scoped, '+' is the / separator)
    //   "react-dom@19.2.4_react@19.2.4"
    // Take the segment before the first '_' (strips peer suffix), then split
    // at the version '@' (after a leading scope '@', if any).
    const beforePeers = pkgKey.split("_")[0];
    const scoped = beforePeers.startsWith("@");
    const verAt = beforePeers.indexOf("@", scoped ? 1 : 0);
    if (verAt <= 0) continue;
    const pkgName = beforePeers.slice(0, verAt).replace(/\+/g, "/");

    const src = path.join(innerNm, pkgName);
    if (!fs.existsSync(src)) continue;

    const dest = path.join(nmDir, pkgName);
    if (fs.existsSync(dest)) {
      // Top-level already populated (multi-version conflict or symlink we
      // haven't cleared). Replace with the canonical copy.
      fs.rmSync(dest, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true, dereference: true });
    copied++;
  }

  return copied;
}

// Clear stale top-level symlinks first so flatten populates with real dirs.
if (fs.existsSync(standaloneNm)) {
  for (const entry of fs.readdirSync(standaloneNm, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      fs.rmSync(path.join(standaloneNm, entry.name), { recursive: true, force: true });
    }
  }
}

const flattened = flattenPnpmStore(standaloneNm);
if (flattened > 0) {
  console.log(`[prune-standalone] Flattened ${flattened} packages from .pnpm/`);
}

const pnpmDir = path.join(standaloneNm, ".pnpm");
if (fs.existsSync(pnpmDir)) {
  fs.rmSync(pnpmDir, { recursive: true, force: true });
  console.log("[prune-standalone] Removed .pnpm/ store");
}

// --- 2. Native-binary prune (post-flatten, so we delete real copies) ---
const NATIVE_PRUNE = ["@prisma", ".prisma", "node-pty", "@vscode", "sharp", "@img", "monaco-editor"];
if (fs.existsSync(standaloneNm)) {
  for (const name of NATIVE_PRUNE) {
    const target = path.join(standaloneNm, name);
    if (fs.existsSync(target) || fs.lstatSync(target, { throwIfNoEntry: false })) {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`[prune-standalone] Removed node_modules/${name}`);
    }
  }
}

// --- 3. Drop Monaco assets (lazy-installed) ---
const publicVs = path.join(standaloneDir, "public", "vs");
if (fs.existsSync(publicVs)) {
  fs.rmSync(publicVs, { recursive: true, force: true });
  console.log("[prune-standalone] Removed public/vs (lazy-installed via Monaco extension)");
}

// --- 4. Allowlist top-level standalone entries the runtime needs ---
const KEEP = new Set(["server.js", "package.json", ".next", "node_modules", "public"]);
let cruftRemoved = 0;
for (const entry of fs.readdirSync(standaloneDir)) {
  if (KEEP.has(entry)) continue;
  fs.rmSync(path.join(standaloneDir, entry), { recursive: true, force: true });
  cruftRemoved++;
}
if (cruftRemoved > 0) {
  console.log(`[prune-standalone] Removed ${cruftRemoved} workspace-cruft entries`);
}

// --- 5. Drop build-time output-file trace manifests after standalone assembly ---
let traceManifestsRemoved = 0;
function removeTraceManifests(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeTraceManifests(target);
    } else if (entry.isFile() && entry.name.endsWith(".nft.json")) {
      fs.rmSync(target, { force: true });
      traceManifestsRemoved++;
    }
  }
}

removeTraceManifests(path.join(standaloneDir, ".next"));
if (traceManifestsRemoved > 0) {
  console.log(`[prune-standalone] Removed ${traceManifestsRemoved} build-time trace manifests`);
}
