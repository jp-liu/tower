#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This release verifier is a published CommonJS entrypoint. */
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const releaseShell = fs.readFileSync(path.join(projectRoot, "scripts", "release.sh"), "utf8");

function assertEqual(label, actual, expected) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function assertContains(label, source, expected) {
  if (!source.includes(expected)) throw new Error(`${label}: missing ${expected}`);
}

assertEqual("package.json#release", pkg.scripts.release, "bash scripts/release.sh");
assertEqual("package.json#release:publish", pkg.scripts["release:publish"], "bash scripts/release.sh --publish");
assertContains("package.json#release:prepare", pkg.scripts["release:prepare"], "pnpm release:gate");
assertContains("package.json#release:prepare", pkg.scripts["release:prepare"], "pnpm release:pack:check");
assertContains("package.json#release:prepare", pkg.scripts["release:prepare"], "pnpm release:docs:check");
assertEqual("package.json#release:portable:build", pkg.scripts["release:portable:build"], "node scripts/build-portable-release.js");
assertEqual("package.json#release:portable:check", pkg.scripts["release:portable:check"], "node scripts/release-portable-canary.js");

const prepareIndex = releaseShell.indexOf("pnpm release:prepare");
const packIndex = releaseShell.indexOf("npm pack --dry-run");
const publishIndex = releaseShell.indexOf("npm publish \"$PACKAGE_TARBALL\" --access public --provenance");
if (prepareIndex < 0 || packIndex < prepareIndex || publishIndex < packIndex) {
  throw new Error("scripts/release.sh must prepare, pack dry-run, then publish in that order");
}
assertContains("scripts/release.sh", releaseShell, "TOWER_RELEASE_APPROVED");
assertContains("scripts/release.sh", releaseShell, "git@github.com:tower-org/tower.git");
assertContains("scripts/release.sh", releaseShell, "scripts/release-context.js");
assertContains("scripts/release.sh", releaseShell, "TOWER_RELEASE_COMMIT");
assertContains("scripts/release.sh", releaseShell, "scripts/verify-release-tarball.js");
assertContains("scripts/release.sh", releaseShell, "dist.integrity");
for (const forbidden of ["git pull", "git tag", "git push", "gh release create"]) {
  if (releaseShell.includes(forbidden)) throw new Error(`scripts/release.sh must not run ${forbidden}`);
}

console.log("[release:entrypoints:check] release entrypoints enforce gate, pack dry-run, explicit approval, and public provenance");
