#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This release verifier is a published CommonJS Node entrypoint. */
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const releaseShell = fs.readFileSync(path.join(projectRoot, "scripts", "release.sh"), "utf8");

function assertSequence(label, actual, expected) {
  if (actual.length !== expected.length || actual.some((command, index) => command !== expected[index])) {
    throw new Error(`${label}: expected ${expected.join(" -> ")}, got ${actual.join(" -> ")}`);
  }
}

assertSequence("package.json#release", pkg.scripts.release.split(" && "), [
  "pnpm build",
  "pnpm release:pack:check",
  "npm pack",
]);
assertSequence("package.json#release:publish", pkg.scripts["release:publish"].split(" && "), [
  "pnpm build",
  "pnpm release:pack:check",
  "npm publish",
]);
const shellCommands = releaseShell.split("\n").map((line) => line.trim());
const releaseShellSequence = [
  "pnpm build",
  "pnpm release:pack:check",
  'with_optional_proxy npm publish --registry "$REGISTRY"',
];
assertSequence(
  "scripts/release.sh",
  shellCommands.filter((line) => releaseShellSequence.includes(line)),
  releaseShellSequence,
);

console.log("[release:entrypoints:check] release, release:publish, and release.sh enforce the package canary");
