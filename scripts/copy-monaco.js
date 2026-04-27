#!/usr/bin/env node
/**
 * Copy monaco-editor/min/vs from node_modules to public/vs
 * so the editor loads locally without CDN dependency.
 *
 * Runs automatically via `postinstall` in package.json.
 */
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "node_modules", "monaco-editor", "min", "vs");
const dest = path.join(__dirname, "..", "public", "vs");

if (!fs.existsSync(src)) {
  console.warn("[copy-monaco] monaco-editor not found in node_modules — skipping");
  process.exit(0);
}

// Remove old copy if exists
if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true, force: true });
}

// Recursive copy
fs.cpSync(src, dest, { recursive: true });

console.log("[copy-monaco] Copied monaco-editor/min/vs → public/vs");
