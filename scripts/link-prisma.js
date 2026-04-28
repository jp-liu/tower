#!/usr/bin/env node
/**
 * Turbopack builds reference @prisma/client with a content hash suffix
 * (e.g. @prisma/client-44bae9bb3052ac14). This script scans the build
 * output for the hashed name and creates a symlink so Node.js can
 * resolve it at runtime.
 *
 * Runs as part of postinstall.
 */
const fs = require("fs");
const path = require("path");

const serverDir = path.join(__dirname, "..", ".next", "server");
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
const nodeModules = path.join(__dirname, "..", "node_modules", "@prisma");
const target = path.join(nodeModules, "client");
const link = path.join(nodeModules, hashedName);

if (fs.existsSync(link)) {
  console.log(`[link-prisma] @prisma/${hashedName} already exists`);
  process.exit(0);
}

if (!fs.existsSync(target)) {
  console.warn("[link-prisma] @prisma/client not found, skipping");
  process.exit(0);
}

fs.symlinkSync(target, link, "junction");
console.log(`[link-prisma] Linked @prisma/${hashedName} → @prisma/client`);
