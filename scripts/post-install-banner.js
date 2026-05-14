#!/usr/bin/env node
/**
 * Print a welcome banner after `npm install tower-studio`.
 * Skipped in CI to avoid polluting build logs.
 */
const fs = require("fs");
const path = require("path");

if (process.env.CI === "true") process.exit(0);

const packageRoot = path.join(__dirname, "..");
let version = "";
try {
  version = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8")
  ).version;
} catch {
  process.exit(0);
}

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s) => c("32", s);
const bold = (s) => c("1", s);
const dim = (s) => c("2", s);
const cyan = (s) => c("36", s);
const underline = (s) => c("4", s);

const lines = [
  ``,
  `${green("✓")} ${bold(`tower-studio v${version} installed`)}`,
  ``,
  `  ${dim("Next steps:")}`,
  `    ${cyan("tower")}         Start server (default http://localhost:3000)`,
  `    ${cyan("tower -h")}      Show all commands and options`,
  ``,
  `  Docs: ${underline("https://github.com/jp-liu/tower")}`,
  ``,
];

console.log(lines.join("\n"));
