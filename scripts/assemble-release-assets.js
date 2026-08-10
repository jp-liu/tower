#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Release asset assembler. */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const pkg = require(path.join(__dirname, "..", "package.json"));
const CHANGELOG_PATH = path.join(__dirname, "..", "CHANGELOG.md");

const TARGETS = [
  ["darwin", "arm64", "tar.gz"],
  ["darwin", "x64", "tar.gz"],
  ["linux", "arm64", "tar.gz"],
  ["linux", "x64", "tar.gz"],
  ["windows", "x64", "tar.gz"],
];

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function findFiles(root, predicate, result = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) findFiles(candidate, predicate, result);
    else if (predicate(candidate)) result.push(candidate);
  }
  return result;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function releaseChanges() {
  const lines = fs.readFileSync(CHANGELOG_PATH, "utf8").split(/\r?\n/);
  const heading = `## [${pkg.version}]`;
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} - `));
  if (start < 0) throw new Error(`CHANGELOG.md is missing a ${heading} section`);
  const end = lines.findIndex((line, index) => index > start && /^## \[[^\]]+\]/.test(line));
  const section = lines.slice(start + 1, end < 0 ? lines.length : end).join("\n").trim();
  if (!section) throw new Error(`CHANGELOG.md ${heading} section is empty`);
  return section;
}

function validateCandidateMetadata(candidate, commit) {
  if (!candidate) return null;
  const required = ["ref", "dispatchRef", "runId", "runAttempt", "generatedAt"];
  for (const field of required) {
    if (typeof candidate[field] !== "string" || candidate[field].trim() === "") {
      throw new Error(`candidate metadata ${field} is required`);
    }
  }
  if (!/^\d+$/.test(candidate.runId) || !/^[1-9]\d*$/.test(candidate.runAttempt)) {
    throw new Error("candidate workflow run id and attempt must be positive integers");
  }
  const generatedAt = new Date(candidate.generatedAt);
  if (!Number.isFinite(generatedAt.getTime()) || !candidate.generatedAt.endsWith("Z")) {
    throw new Error("candidate generatedAt must be an ISO-8601 UTC timestamp");
  }
  return {
    schema: 1,
    kind: "release-candidate",
    published: false,
    commit,
    ref: candidate.ref,
    dispatchRef: candidate.dispatchRef,
    packageName: pkg.name,
    packageVersion: pkg.version,
    workflow: {
      runId: candidate.runId,
      runAttempt: candidate.runAttempt,
    },
    generatedAt: candidate.generatedAt,
  };
}

function candidateNotes(metadata, npmName, targetRows, changes) {
  return `# Tower Release Candidate\n\n` +
    `> **NOT A RELEASE:** This is an unpublished preview built from commit \`${metadata.commit}\`. No Git tag, npm publication, or GitHub Release was created.\n\n` +
    `Source ref: \`${metadata.ref}\`  \n` +
    `Package manifest: \`${metadata.packageName}@${metadata.packageVersion}\` (build identity only; this does not mean the commit was published under this version)  \n` +
    `Workflow run: \`${metadata.workflow.runId}\`, attempt \`${metadata.workflow.runAttempt}\`  \n` +
    `Generated: \`${metadata.generatedAt}\`\n\n` +
    `## Changes under review\n\n${changes}\n\n` +
    `## Portable targets\n\n| OS | CPU | Asset |\n| --- | --- | --- |\n${targetRows}\n\n` +
    `Every listed target passed the native offline smoke on Node.js 22 and 24 with npm and Prisma download hosts blocked. Each adjacent \`.manifest.json\` file records its package, source commit, runtime policy, platform, and architecture.\n\n` +
    `## Verify and install this Candidate\n\n` +
    `Keep the selected portable archive and \`SHA256SUMS\` in this directory. Verify the matching checksum before installation. On macOS/Linux run \`sh install.sh --asset-dir . --verify\` first, then omit \`--verify\` to install. On Windows run \`powershell -NoProfile -ExecutionPolicy Bypass -File .\\install.ps1 -AssetDir . -Verify\` first, then omit \`-Verify\` to install. Node.js 22 or 24 is required.\n\n` +
    `The \`${npmName}\` file is the unmodified \`npm pack\` input retained for audit. It is not evidence of an npm publication and still requires dependency resolution when installed directly.\n`;
}

function assemble(inputDir, outputDir, commit, options = {}) {
  if (!/^[0-9a-f]{40}$/.test(commit || "")) throw new Error("--commit must be a full Git SHA");
  const candidateMetadata = validateCandidateMetadata(options.candidate, commit);
  const changes = releaseChanges();
  fs.mkdirSync(outputDir, { recursive: true });
  const copied = [];
  for (const [platform, arch, extension] of TARGETS) {
    const name = `tower-portable-${platform}-${arch}.${extension}`;
    const matches = findFiles(inputDir, (file) => path.basename(file) === name);
    const manifests = findFiles(inputDir, (file) => path.basename(file) === `${name}.manifest.json`);
    if (matches.length !== 1 || manifests.length !== 1) throw new Error(`expected one tested ${name} and manifest`);
    const manifest = JSON.parse(fs.readFileSync(manifests[0], "utf8"));
    if (manifest.version !== pkg.version || manifest.platform !== platform || manifest.arch !== arch || manifest.sourceCommit !== commit) {
      throw new Error(`${name} manifest does not match package/target/commit`);
    }
    fs.copyFileSync(matches[0], path.join(outputDir, name));
    copied.push(name);
    if (candidateMetadata) {
      const manifestName = `${name}.manifest.json`;
      fs.copyFileSync(manifests[0], path.join(outputDir, manifestName));
      copied.push(manifestName);
    }
  }
  const tarballs = findFiles(inputDir, (file) => file.endsWith(".tgz"));
  if (tarballs.length !== 1) throw new Error(`expected one npm pack tarball, found ${tarballs.length}`);
  const npmName = `tower-org-cli-${pkg.version}.tgz`;
  fs.copyFileSync(tarballs[0], path.join(outputDir, npmName));
  copied.push(npmName);
  for (const installer of ["install.sh", "install.ps1"]) {
    fs.copyFileSync(path.join(__dirname, installer), path.join(outputDir, installer));
    copied.push(installer);
  }
  if (candidateMetadata) {
    const metadataName = "CANDIDATE_METADATA.json";
    fs.writeFileSync(path.join(outputDir, metadataName), `${JSON.stringify(candidateMetadata, null, 2)}\n`);
    copied.push(metadataName);
  }
  copied.sort();
  const sums = copied.map((name) => `${sha256(path.join(outputDir, name))}  ${name}`).join("\n");
  fs.writeFileSync(path.join(outputDir, "SHA256SUMS"), `${sums}\n`);

  const targetRows = TARGETS.map(([platform, arch, extension]) => `| ${platform} | ${arch} | \`tower-portable-${platform}-${arch}.${extension}\` |`).join("\n");
  const notes = candidateMetadata ? candidateNotes(candidateMetadata, npmName, targetRows, changes) : `# Tower v${pkg.version}\n\n` +
    `Package: [\`${pkg.name}@${pkg.version}\`](https://www.npmjs.com/package/${pkg.name}/v/${pkg.version})  \n` +
    `Source commit: \`${commit}\`\n\n` +
    `## What's changed\n\n${changes}\n\n` +
    `The npm package with provenance remains the standard registry channel. The \`${npmName}\` asset is the exact npm pack input for audit and offline npm clients; it still requires npm dependency resolution. Use a platform portable asset for a registry-free installation. GitHub's automatic source archives are source code, not Tower installers.\n\n` +
    `## Portable targets\n\n| OS | CPU | Asset |\n| --- | --- | --- |\n${targetRows}\n\n` +
    `Every listed target passed a native runner smoke covering first database creation, migrations, Prisma Client/Query/Schema Engines, MCP startup, node-pty, ripgrep, and Tower HTTP startup with npm/Prisma download endpoints blocked. Targets that do not pass are not assembled or published.\n\n` +
    `## Node.js\n\nNode.js >=22.0.0 is required and is not bundled or installed by Tower. Node 22 and 24 are tested on every release target. Other versions meeting the minimum continue in best-effort mode unless listed as specifically incompatible.\n\n` +
    `## Verify\n\nDownload the asset and \`SHA256SUMS\`, then filter the selected filename and run \`sha256sum -c -\` (Linux) or \`shasum -a 256 -c -\` (macOS); on Windows compare \`Get-FileHash <asset> -Algorithm SHA256\` with the matching line in \`SHA256SUMS\`. Review \`install.sh\` or \`install.ps1\` before execution.\n\n` +
    `## Install and recovery\n\nThe versioned download base is \`https://github.com/tower-org/tower/releases/download/v${pkg.version}\`. On Windows run \`install.ps1\` from PowerShell; use a process-scoped \`-ExecutionPolicy Bypass\` only when local policy requires it. Pass \`--version ${pkg.version}\` / \`-Version ${pkg.version}\` to pin this release. The installers support \`--rollback\` / \`-Rollback\` and \`--uninstall\` / \`-Uninstall\`; uninstall preserves \`~/.tower\` user data. The maintained installation guide is https://tower-org.github.io/tower/guide/getting-started.html (English: https://tower-org.github.io/tower/en/guide/getting-started.html).\n`;
  const notesName = candidateMetadata ? "CANDIDATE_RELEASE_NOTES.md" : "RELEASE_NOTES.md";
  fs.writeFileSync(path.join(outputDir, notesName), notes);
  return { copied, notes };
}

function main() {
  const input = option("--input");
  const output = option("--output");
  const commit = option("--commit");
  if (!input || !output) throw new Error("Usage: assemble-release-assets --input DIR --output DIR --commit SHA");
  const candidateRef = option("--candidate-ref");
  const candidate = candidateRef ? {
    ref: candidateRef,
    dispatchRef: option("--dispatch-ref"),
    runId: option("--run-id"),
    runAttempt: option("--run-attempt"),
    generatedAt: option("--generated-at"),
  } : undefined;
  const result = assemble(path.resolve(input), path.resolve(output), commit, { candidate });
  console.log(`[release:assets] assembled ${result.copied.length} immutable assets`);
}

module.exports = { TARGETS, assemble, candidateNotes, releaseChanges, sha256, validateCandidateMetadata };
if (require.main === module) main();
