#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Release asset assembler. */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const pkg = require(path.join(__dirname, "..", "package.json"));

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

function assemble(inputDir, outputDir, commit) {
  if (!/^[0-9a-f]{40}$/.test(commit || "")) throw new Error("--commit must be a full Git SHA");
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
  copied.sort();
  const sums = copied.map((name) => `${sha256(path.join(outputDir, name))}  ${name}`).join("\n");
  fs.writeFileSync(path.join(outputDir, "SHA256SUMS"), `${sums}\n`);

  const targetRows = TARGETS.map(([platform, arch, extension]) => `| ${platform} | ${arch} | \`tower-portable-${platform}-${arch}.${extension}\` |`).join("\n");
  const notes = `# Tower v${pkg.version}\n\n` +
    `Package: [\`${pkg.name}@${pkg.version}\`](https://www.npmjs.com/package/${pkg.name}/v/${pkg.version})  \n` +
    `Source commit: \`${commit}\`\n\n` +
    `The npm package with provenance remains the standard registry channel. The \`${npmName}\` asset is the exact npm pack input for audit and offline npm clients; it still requires npm dependency resolution. Use a platform portable asset for a registry-free installation. GitHub's automatic source archives are source code, not Tower installers.\n\n` +
    `## Portable targets\n\n| OS | CPU | Asset |\n| --- | --- | --- |\n${targetRows}\n\n` +
    `Every listed target passed a native runner smoke covering first database creation, migrations, Prisma Client/Query/Schema Engines, MCP startup, node-pty, ripgrep, and Tower HTTP startup with npm/Prisma download endpoints blocked. Targets that do not pass are not assembled or published.\n\n` +
    `## Node.js\n\nNode.js >=22.0.0 is required and is not bundled or installed by Tower. Node 22 and 24 are tested on every release target. Other versions meeting the minimum continue in best-effort mode unless listed as specifically incompatible.\n\n` +
    `## Verify\n\nDownload the asset and \`SHA256SUMS\`, then filter the selected filename and run \`sha256sum -c -\` (Linux) or \`shasum -a 256 -c -\` (macOS); on Windows compare \`Get-FileHash <asset> -Algorithm SHA256\` with the matching line in \`SHA256SUMS\`. Review \`install.sh\` / \`install.ps1\` before execution. The maintained installation guide is https://tower-org.github.io/tower/guide/getting-started.html (English: https://tower-org.github.io/tower/en/guide/getting-started.html).\n`;
  fs.writeFileSync(path.join(outputDir, "RELEASE_NOTES.md"), notes);
  return { copied, notes };
}

function main() {
  const input = option("--input");
  const output = option("--output");
  const commit = option("--commit");
  if (!input || !output) throw new Error("Usage: assemble-release-assets --input DIR --output DIR --commit SHA");
  const result = assemble(path.resolve(input), path.resolve(output), commit);
  console.log(`[release:assets] assembled ${result.copied.length} immutable assets`);
}

module.exports = { TARGETS, assemble, sha256 };
if (require.main === module) main();
