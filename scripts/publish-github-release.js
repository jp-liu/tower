#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Idempotent GitHub Release publisher. */
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function ghJson(args, options = {}) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", ...options }));
}

function getRelease(repository, tag) {
  try {
    return ghJson(["api", `repos/${repository}/releases/tags/${tag}`], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (error.status === 1 && String(error.stderr).includes("HTTP 404")) return null;
    throw error;
  }
}

function createRelease(repository, tag, commit, notes) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tower-release-create-"));
  const input = path.join(temporary, "release.json");
  try {
    fs.writeFileSync(input, JSON.stringify({ tag_name: tag, target_commitish: commit, name: tag, body: notes, draft: false, prerelease: false }));
    return ghJson(["api", "--method", "POST", `repos/${repository}/releases`, "--input", input]);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function existingAssetHash(asset) {
  if (asset.digest?.startsWith("sha256:")) return asset.digest.slice("sha256:".length);
  const temporary = path.join(os.tmpdir(), `tower-release-asset-${asset.id}-${process.pid}`);
  const output = fs.openSync(temporary, "w");
  try {
    const downloaded = spawnSync("gh", ["api", asset.url, "-H", "Accept: application/octet-stream"], {
      stdio: ["ignore", output, "pipe"],
    });
    if (downloaded.status !== 0) throw new Error(`failed to download existing asset ${asset.name}: ${downloaded.stderr}`);
    return sha256(temporary);
  } finally {
    fs.closeSync(output);
    fs.rmSync(temporary, { force: true });
  }
}

function verifyExistingAsset(asset, file) {
  const remoteHash = existingAssetHash(asset);
  const localHash = sha256(file);
  if (remoteHash !== localHash) {
    throw new Error(`existing asset ${asset.name} conflicts (${remoteHash} != ${localHash}); refusing to overwrite`);
  }
  return localHash;
}

function assertReleaseIdentity(release, tag, notes) {
  if (release.tag_name !== tag) throw new Error(`release tag mismatch: ${release.tag_name}`);
  if ((release.body || "").trim() !== notes.trim()) {
    throw new Error(`existing ${tag} release notes conflict; refusing to overwrite`);
  }
}

function publish({ repository, tag, commit, assetsDir, notesPath }) {
  const notes = fs.readFileSync(notesPath, "utf8");
  let release = getRelease(repository, tag);
  if (!release) release = createRelease(repository, tag, commit, notes);
  assertReleaseIdentity(release, tag, notes);
  const existing = new Map((release.assets || []).map((asset) => [asset.name, asset]));
  const files = fs.readdirSync(assetsDir)
    .filter((name) => name !== path.basename(notesPath))
    .sort();
  for (const name of files) {
    const file = path.join(assetsDir, name);
    if (!fs.statSync(file).isFile()) continue;
    const asset = existing.get(name);
    if (asset) {
      const localHash = verifyExistingAsset(asset, file);
      console.log(`[release:github] reuse ${name} (${localHash})`);
      continue;
    }
    execFileSync("gh", ["release", "upload", tag, file, "--repo", repository], { stdio: "inherit" });
  }
  console.log(`[release:github] ${tag} assets are complete`);
}

function main() {
  const repository = option("--repository", process.env.GITHUB_REPOSITORY);
  const tag = option("--tag", process.env.TOWER_RELEASE_TAG);
  const commit = option("--commit", process.env.TOWER_RELEASE_COMMIT);
  const assetsDir = option("--assets");
  const notesPath = option("--notes", assetsDir && path.join(assetsDir, "RELEASE_NOTES.md"));
  if (!repository || !tag || !commit || !assetsDir || !notesPath) throw new Error("repository, tag, commit, assets, and notes are required");
  publish({ repository, tag, commit, assetsDir: path.resolve(assetsDir), notesPath: path.resolve(notesPath) });
}

module.exports = { assertReleaseIdentity, existingAssetHash, publish, sha256, verifyExistingAsset };
if (require.main === module) main();
