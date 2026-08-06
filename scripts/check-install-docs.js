#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Installation documentation contract. */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const projectRoot = path.join(__dirname, "..");
const docs = ["docs/guide/getting-started.md", "docs/en/guide/getting-started.md"];
const shellOptions = [
  "--version", "--download-base", "--asset-dir", "--prefix", "--bin-dir",
  "--verify", "--rollback", "--uninstall", "--yes", "--non-interactive",
  "--no-start", "--help",
];
const powershellOptions = [
  "Version", "DownloadBase", "AssetDir", "Prefix", "BinDir", "Verify",
  "Rollback", "Uninstall", "ConfirmNonInteractive", "NoStart", "Help",
];

function assertContains(source, value, label) {
  if (!source.includes(value)) throw new Error(`${label} is missing ${value}`);
}

function main() {
  const installHelp = execFileSync("sh", [path.join(projectRoot, "scripts", "install.sh"), "--help"], { encoding: "utf8" });
  const internalHelp = execFileSync("sh", [path.join(projectRoot, "scripts", "portable", "install"), "--help"], { encoding: "utf8" });
  for (const value of shellOptions) assertContains(installHelp, value, "scripts/install.sh --help");
  for (const value of ["--prefix", "--bin-dir", "--verify", "--rollback", "--uninstall", "--yes", "--no-start", "--help"]) {
    assertContains(internalHelp, value, "portable install --help");
  }

  const ps = fs.readFileSync(path.join(projectRoot, "scripts", "install.ps1"), "utf8");
  const internalPs = fs.readFileSync(path.join(projectRoot, "scripts", "portable", "install.ps1"), "utf8");
  const cmd = fs.readFileSync(path.join(projectRoot, "scripts", "install.cmd"), "utf8");
  for (const value of powershellOptions) assertContains(ps, `$${value}`, "scripts/install.ps1 parameters");
  for (const value of ["Prefix", "BinDir", "Verify", "Rollback", "Uninstall", "ConfirmNonInteractive", "NoStart", "Help"]) {
    assertContains(internalPs, `$${value}`, "portable install.ps1 parameters");
  }
  for (const value of ["powershell.exe", "-ExecutionPolicy Bypass", '"%~dp0install.ps1"', "%*", "exit /b %ERRORLEVEL%"]) {
    assertContains(cmd, value, "scripts/install.cmd wrapper");
  }

  const requiredDocText = [
    "SHA256SUMS", "tower-portable-darwin-arm64.tar.gz", "tower-portable-darwin-x64.tar.gz",
    "tower-portable-linux-arm64.tar.gz", "tower-portable-linux-x64.tar.gz",
    "tower-portable-windows-x64.tar.gz", "binaries.prisma.sh", "node-pty",
    "service install", "install.cmd", "--asset-dir", "--download-base", "--rollback",
    "--uninstall", "--verify", "--no-start", "~/.tower", "VERSION=X.Y.Z",
  ];
  for (const relative of docs) {
    const source = fs.readFileSync(path.join(projectRoot, relative), "utf8");
    for (const value of requiredDocText) assertContains(source, value, relative);
    if (!source.includes("NODE_TLS_REJECT_UNAUTHORIZED=0") || !source.includes("strict-ssl=false")) {
      throw new Error(`${relative} must explicitly reject unsafe TLS workarounds`);
    }
  }

  for (const [readme, url] of [
    ["README.md", "https://tower-org.github.io/tower/en/guide/getting-started.html"],
    ["README.zh.md", "https://tower-org.github.io/tower/guide/getting-started.html"],
  ]) assertContains(fs.readFileSync(path.join(projectRoot, readme), "utf8"), url, readme);

  const builder = fs.readFileSync(path.join(projectRoot, "scripts", "build-portable-release.js"), "utf8");
  if (/INSTALL\.md|README\.txt|portable\/README/.test(builder)) {
    throw new Error("portable archive must not embed installation documentation");
  }
  assertContains(builder, 'path.join(projectRoot, "LICENSE")', "portable license copy");
  console.log("[release:docs:check] installer help, GitHub Pages commands, Node policy, assets, and license boundary match");
}

if (require.main === module) main();
