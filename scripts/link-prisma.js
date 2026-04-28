#!/usr/bin/env node
/**
 * Turbopack builds reference @prisma/client with a content hash suffix
 * (e.g. @prisma/client-44bae9bb3052ac14). This script scans the build
 * output for the hashed name and creates a symlink so Node.js can
 * resolve it at runtime.
 *
 * Works with both npm (flat node_modules) and pnpm (symlinked store).
 * Runs as part of postinstall.
 */
const fs = require("fs");
const path = require("path");

const packageRoot = path.join(__dirname, "..");
const serverDir = path.join(packageRoot, ".next", "server");

if (!fs.existsSync(serverDir)) {
  // No build output yet (dev install), skip silently
  process.exit(0);
}

// Scan for the hashed prisma client reference
const pattern = /@prisma\/client-([0-9a-f]+)/;
let hash = null;

function scanDir(dir) {
  if (hash) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (hash) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full);
    } else if (entry.name.endsWith(".js")) {
      const content = fs.readFileSync(full, "utf-8");
      const match = content.match(pattern);
      if (match) {
        hash = match[1];
        return;
      }
    }
  }
}

scanDir(path.join(serverDir, "chunks"));

if (!hash) {
  console.log("[link-prisma] No hashed prisma reference found, skipping");
  process.exit(0);
}

const hashedName = `client-${hash}`;

// Find where @prisma/client actually lives (works with npm, pnpm, yarn)
let prismaDir;
try {
  const clientEntry = require.resolve("@prisma/client", { paths: [packageRoot] });
  // clientEntry is like .../node_modules/@prisma/client/default.js
  // We need the @prisma/ directory (parent of client/)
  prismaDir = path.dirname(path.dirname(clientEntry));
  // Ensure we're in a @prisma directory
  if (!prismaDir.endsWith(path.join("@prisma", "client"))) {
    // Walk up to find the @prisma directory
    const parts = clientEntry.split(path.sep);
    const prismaIdx = parts.lastIndexOf("@prisma");
    if (prismaIdx >= 0) {
      prismaDir = parts.slice(0, prismaIdx + 1).join(path.sep);
    } else {
      throw new Error("Cannot locate @prisma directory");
    }
  } else {
    // prismaDir = .../node_modules/@prisma/client, go up one level to @prisma/
    prismaDir = path.dirname(prismaDir);
  }
} catch (e) {
  console.warn(`[link-prisma] Cannot resolve @prisma/client: ${e.message}`);
  process.exit(0);
}

const target = path.join(prismaDir, "client");
const link = path.join(prismaDir, hashedName);

if (fs.existsSync(link)) {
  console.log(`[link-prisma] @prisma/${hashedName} already exists`);
  process.exit(0);
}

if (!fs.existsSync(target)) {
  console.warn("[link-prisma] @prisma/client not found at resolved path, skipping");
  process.exit(0);
}

try {
  fs.symlinkSync(target, link, "junction");
  console.log(`[link-prisma] Linked @prisma/${hashedName} → @prisma/client`);
} catch (e) {
  console.warn(`[link-prisma] Failed to create symlink: ${e.message}`);
}
