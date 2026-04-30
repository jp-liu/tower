#!/usr/bin/env node
/**
 * npm pack strips execute permissions from binary files.
 * This script restores +x on native addon helpers that need it.
 */
const fs = require("fs");
const path = require("path");

const packageRoot = path.join(__dirname, "..");

const EXECUTABLES = [
  // node-pty spawn-helper — required for posix_spawnp
  "node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
  "node_modules/node-pty/prebuilds/darwin-x64/spawn-helper",
  "node_modules/node-pty/prebuilds/linux-arm64/spawn-helper",
  "node_modules/node-pty/prebuilds/linux-x64/spawn-helper",
];

let fixed = 0;
for (const rel of EXECUTABLES) {
  const full = path.join(packageRoot, rel);
  if (!fs.existsSync(full)) continue;

  try {
    const stat = fs.statSync(full);
    // Check if execute bit is missing
    if ((stat.mode & 0o111) === 0) {
      fs.chmodSync(full, stat.mode | 0o755);
      console.log(`[fix-native-permissions] +x ${rel}`);
      fixed++;
    }
  } catch (err) {
    console.warn(`[fix-native-permissions] Failed to chmod ${rel}: ${err.message}`);
  }
}

if (fixed === 0) {
  console.log("[fix-native-permissions] All native binaries OK");
}
