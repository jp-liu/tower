#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Cross-platform release builder. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const tar = require("tar");
const { isWindows } = require("./release-platform.js");

const projectRoot = path.join(__dirname, "..");
const packageJson = require(path.join(projectRoot, "package.json"));
const portableDependenciesRoot = path.join(projectRoot, "scripts", "portable-dependencies");
const PLATFORM_NAMES = { darwin: "darwin", linux: "linux", win32: "windows" };
const SUPPORTED_TARGETS = new Set([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "windows-x64",
]);
const EMBEDDED_PACKAGES = {
  "@tower-org/ai-sdk": "packages/ai-sdk",
  "@tower-org/ai-runtime": "packages/ai-runtime",
  "@tower-org/ai-provider-claude": "packages/ai-provider-claude",
  "@tower-org/ai-provider-codex": "packages/ai-provider-codex",
  "@tower-org/ai-provider-gemini": "packages/ai-provider-gemini",
};
const NPM_INSTALL_ARGS = Object.freeze([
  "ci", "--omit=dev", "--include=optional", "--no-audit", "--no-fund", "--foreground-scripts",
  "--registry=https://registry.npmjs.org/",
]);
// Prisma can emit Windows temp roots as relative traversals with raw or JSON-escaped separators.
const PRISMA_RELATIVE_BUILD_ROOT_PATTERN = /(?<![A-Za-z0-9_.-])(?:\.(?:\/|\\{1,2}))?(?:\.\.(?:\/|\\{1,2}))+(?:[^/\\\r\n"'`]+(?:\/|\\{1,2}))*tower-portable-build-[^/\\\r\n"'`]+(?:\/|\\{1,2})(?:[^/\\\r\n"'`]+(?:\/|\\{1,2}))*runtime(?:\/|\\{1,2})package/g;

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function fail(message) {
  throw new Error(`[release:portable:build] ${message}`);
}

function createNpmInstallInvocation(platform = process.platform, env = process.env) {
  const npmArgs = [...NPM_INSTALL_ARGS];
  if (!isWindows(platform)) return { command: "npm", args: npmArgs };

  return {
    command: env.ComSpec || env.COMSPEC || "cmd.exe",
    args: ["/d", "/s", "/c", "npm.cmd", ...npmArgs],
  };
}

function runNpmInstall({ cwd, cacheDir, platform = process.platform, env = process.env, execute = execFileSync }) {
  const invocation = createNpmInstallInvocation(platform, env);
  return execute(invocation.command, invocation.args, {
    cwd,
    stdio: "inherit",
    env: { ...env, npm_config_cache: cacheDir },
  });
}

function validatePortableDependencies() {
  const manifest = JSON.parse(fs.readFileSync(path.join(portableDependenciesRoot, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(portableDependenciesRoot, "package-lock.json"), "utf8"));
  const applicationNames = Object.keys(packageJson.dependencies || {}).sort();
  const portableNames = Object.keys(manifest.dependencies || {}).sort();
  if (manifest.version !== packageJson.version) fail("portable dependency manifest version must match package version");
  if (JSON.stringify(portableNames) !== JSON.stringify(applicationNames)) {
    fail("portable dependency manifest must contain every production dependency and no extras");
  }
  if (JSON.stringify(lock.packages?.[""]?.dependencies) !== JSON.stringify(manifest.dependencies)) {
    fail("portable package-lock root does not match its dependency manifest");
  }
  for (const name of portableNames) {
    const installedRoot = fs.realpathSync(path.join(projectRoot, "node_modules", ...name.split("/")));
    const installed = JSON.parse(fs.readFileSync(path.join(installedRoot, "package.json"), "utf8"));
    const locked = lock.packages?.[`node_modules/${name}`]?.version;
    if (manifest.dependencies[name] !== installed.version || locked !== installed.version) {
      fail(`${name} must match the workspace lock resolution ${installed.version}, got manifest=${manifest.dependencies[name]} lock=${locked}`);
    }
  }
  return { manifest, lock };
}

function platformPackageRoot(runtimeRoot) {
  return path.join(runtimeRoot, "package");
}

function assertLinksContained(root) {
  const canonicalRoot = fs.realpathSync(root);
  function visit(candidate) {
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) {
      const resolved = fs.realpathSync(candidate);
      const relative = path.relative(canonicalRoot, resolved);
      if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
        fail(`dependency link escapes runtime: ${candidate} -> ${resolved}`);
      }
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(candidate)) visit(path.join(candidate, entry));
  }
  visit(root);
}

function makeAbsoluteLinksPortable(root, platform = process.platform) {
  function visit(candidate) {
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(candidate);
      if (!path.isAbsolute(target)) return;
      const resolved = fs.realpathSync(candidate);
      fs.rmSync(candidate, { recursive: true, force: true });
      if (platform === "win32" || platform === "windows") {
        fs.cpSync(resolved, candidate, {
          recursive: true,
          dereference: false,
          verbatimSymlinks: true,
        });
      } else {
        const canonicalParent = fs.realpathSync(path.dirname(candidate));
        fs.symlinkSync(path.relative(canonicalParent, resolved), candidate, "dir");
      }
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(candidate)) visit(path.join(candidate, entry));
  }
  visit(root);
}

function pruneNodePty(packageRoot, platform, arch) {
  const nodePty = fs.realpathSync(path.join(packageRoot, "node_modules", "node-pty"));
  const prebuilds = path.join(nodePty, "prebuilds");
  if (!fs.existsSync(prebuilds)) return;
  const keep = platform === "windows" ? `win32-${arch}` : platform === "darwin" ? `darwin-${arch}` : null;
  for (const entry of fs.readdirSync(prebuilds)) {
    if (entry === keep) continue;
    fs.rmSync(path.join(prebuilds, entry), { recursive: true, force: true });
  }
}

function normalizePrismaGeneratedSource(source, buildRoots) {
  const replacements = new Set();
  for (const root of buildRoots) {
    for (const variant of [root, root.replaceAll("\\", "/"), root.replaceAll("/", "\\")]) {
      replacements.add(variant);
      replacements.add(JSON.stringify(variant).slice(1, -1));
    }
  }
  for (const buildRoot of [...replacements].sort((left, right) => right.length - left.length)) {
    source = source.split(buildRoot).join("/tower-portable/runtime/package");
  }
  return source.replace(PRISMA_RELATIVE_BUILD_ROOT_PATTERN, "/tower-portable/runtime/package");
}

function temporaryBuildPathContext(source, radius = 120) {
  const marker = "tower-portable-build-";
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = Math.max(0, markerIndex - radius);
  const end = Math.min(source.length, markerIndex + marker.length + radius);
  const excerpt = `${start > 0 ? "..." : ""}${source.slice(start, end)}${end < source.length ? "..." : ""}`;
  return JSON.stringify(excerpt);
}

function normalizePrismaGeneratedPaths(packageRoot) {
  const generatedRoot = path.join(packageRoot, "node_modules", ".prisma", "client");
  const buildRoots = new Set([
    path.resolve(packageRoot),
    fs.realpathSync(packageRoot),
    fs.realpathSync.native(packageRoot),
  ]);
  for (const name of ["edge.js", "index.js", "wasm.js"]) {
    const file = path.join(generatedRoot, name);
    if (!fs.existsSync(file)) continue;
    const source = normalizePrismaGeneratedSource(fs.readFileSync(file, "utf8"), buildRoots);
    if (source.includes("tower-portable-build-")) {
      fail(`Prisma generated client contains a temporary build path: ${name}; context=${temporaryBuildPathContext(source)}`);
    }
    fs.writeFileSync(file, source);
  }
}

function copyEmbeddedPackages(packageRoot) {
  for (const [name, relative] of Object.entries(EMBEDDED_PACKAGES)) {
    const source = path.join(packageRoot, relative);
    const destination = path.join(packageRoot, "node_modules", ...name.split("/"));
    if (!fs.existsSync(source)) fail(`npm tarball is missing embedded package ${name}`);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true, dereference: false, verbatimSymlinks: true });
  }
}

function normalizeTree(root, epochSeconds) {
  const stamp = new Date(epochSeconds * 1000);
  function visit(candidate) {
    const stat = fs.lstatSync(candidate);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(candidate).sort()) visit(path.join(candidate, entry));
    }
    fs.utimesSync(candidate, stamp, stamp);
  }
  visit(root);
}

function copyPortableFiles(payloadRoot, platform) {
  const portableDir = path.join(projectRoot, "scripts", "portable");
  fs.mkdirSync(path.join(payloadRoot, "bin"), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, "LICENSE"), path.join(payloadRoot, "LICENSE"));
  if (platform === "windows") {
    fs.copyFileSync(path.join(portableDir, "install.ps1"), path.join(payloadRoot, "install.ps1"));
    fs.copyFileSync(path.join(portableDir, "tower.cmd"), path.join(payloadRoot, "bin", "tower.cmd"));
    fs.copyFileSync(path.join(portableDir, "tower.ps1"), path.join(payloadRoot, "bin", "tower.ps1"));
  } else {
    fs.copyFileSync(path.join(portableDir, "install"), path.join(payloadRoot, "install"));
    fs.copyFileSync(path.join(portableDir, "tower"), path.join(payloadRoot, "bin", "tower"));
    fs.chmodSync(path.join(payloadRoot, "install"), 0o755);
    fs.chmodSync(path.join(payloadRoot, "bin", "tower"), 0o755);
  }
}

async function buildPortableRelease(options) {
  const platform = PLATFORM_NAMES[process.platform];
  const arch = process.arch;
  if (!platform || !SUPPORTED_TARGETS.has(`${platform}-${arch}`)) {
    fail(`unsupported build host ${process.platform}-${arch}`);
  }
  if (options.expectedPlatform && options.expectedPlatform !== platform) {
    fail(`runner platform mismatch: expected ${options.expectedPlatform}, got ${platform}`);
  }
  if (options.expectedArch && options.expectedArch !== arch) {
    fail(`runner architecture mismatch: expected ${options.expectedArch}, got ${arch}`);
  }
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 22) fail(`build requires Node.js >=22.0.0, got ${process.version}`);

  let tarball = path.resolve(options.tarball);
  if (fs.existsSync(tarball) && fs.statSync(tarball).isDirectory()) {
    const candidates = fs.readdirSync(tarball).filter((name) => name.endsWith(".tgz"));
    if (candidates.length !== 1) fail(`expected one npm tarball in ${tarball}, found ${candidates.length}`);
    tarball = path.join(tarball, candidates[0]);
  }
  const outputDir = path.resolve(options.outputDir);
  if (!fs.existsSync(tarball) || !tarball.endsWith(".tgz")) fail(`npm tarball not found: ${tarball}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tower-portable-build-"));
  const rootName = `tower-v${packageJson.version}-${platform}-${arch}`;
  const payloadRoot = path.join(temporary, rootName);
  const runtimeRoot = path.join(payloadRoot, "runtime");
  const extractedRoot = path.join(temporary, "npm-pack");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.mkdirSync(extractedRoot, { recursive: true });
  try {
    validatePortableDependencies();
    await tar.x({ file: tarball, cwd: extractedRoot, strict: true });

    const packageRoot = platformPackageRoot(runtimeRoot);
    const packedPackage = path.join(extractedRoot, "package");
    if (!fs.existsSync(packedPackage)) fail(`npm tarball package root missing: ${packedPackage}`);
    fs.cpSync(packedPackage, packageRoot, { recursive: true, dereference: false, verbatimSymlinks: true });
    for (const readme of ["README.md", "README.zh.md"]) {
      fs.rmSync(path.join(packageRoot, readme), { force: true });
    }

    fs.copyFileSync(path.join(portableDependenciesRoot, "package.json"), path.join(packageRoot, "package.json"));
    fs.copyFileSync(path.join(portableDependenciesRoot, "package-lock.json"), path.join(packageRoot, "package-lock.json"));
    runNpmInstall({
      cwd: packageRoot,
      cacheDir: path.join(temporary, "npm-cache"),
    });
    fs.copyFileSync(path.join(packedPackage, "package.json"), path.join(packageRoot, "package.json"));
    fs.rmSync(path.join(packageRoot, "package-lock.json"), { force: true });
    fs.rmSync(path.join(packageRoot, "scripts", "portable-dependencies"), { recursive: true, force: true });
    copyEmbeddedPackages(packageRoot);

    const installed = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
    if (installed.name !== packageJson.name || installed.version !== packageJson.version) {
      fail(`tarball identity mismatch: expected ${packageJson.name}@${packageJson.version}, got ${installed.name}@${installed.version}`);
    }

    for (const script of ["generate-prisma-client.js", "link-prisma.js", "fix-native-permissions.js"]) {
      execFileSync(process.execPath, [path.join(packageRoot, "scripts", script)], {
        cwd: packageRoot,
        stdio: "inherit",
        env: process.env,
      });
    }
    normalizePrismaGeneratedPaths(packageRoot);
    makeAbsoluteLinksPortable(runtimeRoot, platform);
    pruneNodePty(packageRoot, platform, arch);
    assertLinksContained(runtimeRoot);
    copyPortableFiles(payloadRoot, platform);
    const sourceCommit = options.commit || execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();
    const manifest = {
      schema: 1,
      package: packageJson.name,
      version: packageJson.version,
      platform,
      arch,
      node: { minimum: "22.0.0", tested: ["22", "24"], knownIncompatible: [] },
      sourceCommit,
      packageRoot: path.relative(payloadRoot, packageRoot).split(path.sep).join("/"),
      towerEntry: platform === "windows" ? "bin/tower.cmd" : "bin/tower",
      mcpEntry: `${path.relative(payloadRoot, packageRoot).split(path.sep).join("/")}/dist/mcp-server.cjs`,
    };
    fs.writeFileSync(path.join(payloadRoot, "portable-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    execFileSync(process.execPath, [path.join(projectRoot, "scripts", "release-portable-canary.js"), "--root", payloadRoot], {
      cwd: projectRoot,
      stdio: "inherit",
    });

    const epoch = Number(options.epoch || execFileSync("git", ["show", "-s", "--format=%ct", sourceCommit], {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim());
    if (!Number.isSafeInteger(epoch) || epoch <= 0) fail(`invalid source epoch: ${options.epoch}`);
    normalizeTree(payloadRoot, epoch);

    const extension = "tar.gz";
    const assetName = `tower-portable-${platform}-${arch}.${extension}`;
    const assetPath = path.join(outputDir, assetName);
    fs.rmSync(assetPath, { force: true });
    await tar.c({ cwd: temporary, gzip: true, portable: true, mtime: new Date(epoch * 1000), file: assetPath }, [rootName]);
    fs.writeFileSync(path.join(outputDir, `${assetName}.manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`[release:portable:build] ${assetPath}`);
    return { assetPath, manifest };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

async function main() {
  const tarball = option("--tarball");
  if (!tarball) fail("--tarball is required");
  await buildPortableRelease({
    tarball,
    outputDir: option("--output", path.join(projectRoot, "release-assets")),
    expectedPlatform: option("--platform"),
    expectedArch: option("--arch"),
    commit: option("--commit", process.env.TOWER_RELEASE_COMMIT),
    epoch: option("--epoch", process.env.SOURCE_DATE_EPOCH),
  });
}

module.exports = {
  SUPPORTED_TARGETS,
  assertLinksContained,
  buildPortableRelease,
  createNpmInstallInvocation,
  makeAbsoluteLinksPortable,
  normalizePrismaGeneratedPaths,
  normalizePrismaGeneratedSource,
  platformPackageRoot,
  pruneNodePty,
  runNpmInstall,
  temporaryBuildPathContext,
  validatePortableDependencies,
};
if (require.main === module) main().catch((error) => { console.error(error.message); process.exit(1); });
