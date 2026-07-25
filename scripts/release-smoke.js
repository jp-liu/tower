#!/usr/bin/env node
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const projectRoot = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
let port = process.env.TOWER_SMOKE_PORT || null;
const host = "127.0.0.1";
const stamp = `${Date.now()}`;
const baseDir = path.join(os.tmpdir(), `tower-smoke-${stamp}`);
const prefixDir = path.join(baseDir, "prefix");
const cacheDir = path.join(baseDir, "npm-cache");
const homeDir = path.join(baseDir, "home");
const dataDir = path.join(baseDir, "tower-data");
const logPath = path.join(baseDir, "tower.log");
const registryDir = path.join(baseDir, "registry");

fs.mkdirSync(prefixDir, { recursive: true });
fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(homeDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(registryDir, { recursive: true });

let child = null;
let registry = null;

function cleanEnvironment(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const key of [
    "__NEXT_PRIVATE_ORIGIN",
    "__NEXT_PRIVATE_STANDALONE_CONFIG",
    "CALLBACK_URL",
    "TOWER_TASK_ID",
    "TOWER_TASK_TITLE",
    "TURBOPACK",
  ]) {
    delete env[key];
  }
  return env;
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: cleanEnvironment(),
    ...options,
  });
}

function runAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const processHandle = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      env: cleanEnvironment(),
      ...options,
    });
    processHandle.once("error", reject);
    processHandle.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

function collectInstalledPackages() {
  const packages = new Map();

  function registerPackage(packageDir) {
    const packageJsonPath = path.join(packageDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) return;
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      if (!packageJson.name || !packageJson.version) return;
      const versions = packages.get(packageJson.name) || new Map();
      versions.set(packageJson.version, { packageDir: fs.realpathSync(packageDir), packageJson });
      packages.set(packageJson.name, versions);
    } catch {}
  }

  function scanNodeModules(nodeModulesDir) {
    if (!fs.existsSync(nodeModulesDir)) return;
    for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = path.join(nodeModulesDir, entry.name);
      if (entry.name.startsWith("@")) {
        if (!entry.isDirectory()) continue;
        for (const scopedEntry of fs.readdirSync(entryPath, { withFileTypes: true })) {
          if (scopedEntry.isDirectory() || scopedEntry.isSymbolicLink()) {
            registerPackage(path.join(entryPath, scopedEntry.name));
          }
        }
      } else if (entry.isDirectory() || entry.isSymbolicLink()) {
        registerPackage(entryPath);
      }
    }
  }

  const nodeModulesDir = path.join(projectRoot, "node_modules");
  scanNodeModules(nodeModulesDir);
  const virtualStoreDir = path.join(nodeModulesDir, ".pnpm");
  if (fs.existsSync(virtualStoreDir)) {
    for (const entry of fs.readdirSync(virtualStoreDir, { withFileTypes: true })) {
      if (entry.isDirectory()) scanNodeModules(path.join(virtualStoreDir, entry.name, "node_modules"));
    }
  }

  return packages;
}

async function startLocalRegistry() {
  const packages = collectInstalledPackages();
  const tarballs = new Map();

  registry = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || "/", `http://${host}`);
    if (req.method === "POST" && requestUrl.pathname.includes("/-/npm/v1/security/")) {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
      return;
    }

    if (requestUrl.pathname.startsWith("/tarballs/")) {
      const [, , encodedName, encodedVersion] = requestUrl.pathname.split("/");
      const name = decodeURIComponent(encodedName || "");
      const version = decodeURIComponent((encodedVersion || "").replace(/\.tgz$/, ""));
      const packageInfo = packages.get(name)?.get(version);
      if (!packageInfo) {
        res.writeHead(404);
        res.end("not found");
        return;
      }

      try {
        const cacheKey = `${name}@${version}`;
        let tarballPath = tarballs.get(cacheKey);
        if (!tarballPath) {
          const tarballName = execFileSync(
            "npm",
            ["pack", packageInfo.packageDir, "--ignore-scripts", "--silent", "--pack-destination", registryDir],
            { cwd: projectRoot, encoding: "utf8", env: cleanEnvironment({ NPM_CONFIG_CACHE: cacheDir }) }
          ).trim().split("\n").pop();
          tarballPath = path.join(registryDir, tarballName);
          tarballs.set(cacheKey, tarballPath);
        }
        const stat = fs.statSync(tarballPath);
        res.writeHead(200, { "content-length": stat.size, "content-type": "application/octet-stream" });
        fs.createReadStream(tarballPath).pipe(res);
      } catch (error) {
        res.writeHead(500);
        res.end(error.message);
      }
      return;
    }

    const name = decodeURIComponent(requestUrl.pathname.slice(1));
    const versions = packages.get(name);
    if (!versions) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "package not available in local fixture registry" }));
      return;
    }

    const registryAddress = registry.address();
    const registryPort = typeof registryAddress === "object" && registryAddress ? registryAddress.port : 0;
    const versionEntries = {};
    for (const [version, packageInfo] of versions) {
      versionEntries[version] = {
        ...packageInfo.packageJson,
        dist: {
          tarball: `http://${host}:${registryPort}/tarballs/${encodeURIComponent(name)}/${encodeURIComponent(version)}.tgz`,
        },
      };
    }
    const latest = Array.from(versions.keys()).at(-1);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ name, "dist-tags": { latest }, versions: versionEntries }));
  });

  await new Promise((resolve, reject) => {
    registry.once("error", reject);
    registry.listen(0, host, resolve);
  });
  const address = registry.address();
  const registryPort = typeof address === "object" && address ? address.port : null;
  if (!registryPort) throw new Error("Local fixture registry did not bind a temporary port");
  return `http://${host}:${registryPort}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestRoot() {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host,
        port: Number(port),
        path: "/",
        timeout: 3000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode || 0);
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = require("net").createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const selected = typeof address === "object" && address ? address.port : null;
      server.close(() => selected ? resolve(String(selected)) : reject(new Error("No temporary port allocated")));
    });
  });
}

function waitForExit(processHandle, timeoutMs) {
  if (!processHandle || processHandle.exitCode !== null) return Promise.resolve(true);
  return Promise.race([
    new Promise((resolve) => processHandle.once("exit", () => resolve(true))),
    wait(timeoutMs).then(() => false),
  ]);
}

async function stopChild() {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      return;
    }
    process.kill(-child.pid, "SIGTERM");
    if (!await waitForExit(child, 5000)) process.kill(-child.pid, "SIGKILL");
  } catch {}
}

async function stopRegistry() {
  if (!registry) return;
  await new Promise((resolve) => registry.close(resolve));
  registry = null;
}

async function waitForServer(pid) {
  const start = Date.now();
  while (Date.now() - start < 60000) {
    try {
      const status = await requestRoot();
      if (status > 0) {
        return;
      }
    } catch {}
    await wait(1000);
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {}

  const logs = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf-8") : "(no logs)";
  throw new Error(`Smoke server did not become reachable.\n\nLog tail:\n${logs.slice(-4000)}`);
}

async function main() {
  port = port || await findFreePort();
  console.log(`[release:smoke] Building ${pkg.name}@${pkg.version}`);
  run("pnpm", ["build"]);

  console.log("[release:smoke] Packing tarball");
  const tarball = execFileSync("npm", ["pack", "--cache", cacheDir, "--pack-destination", baseDir], {
    cwd: projectRoot,
    encoding: "utf-8",
    env: process.env,
  })
    .trim()
    .split("\n")
    .pop();

  if (!tarball) {
    throw new Error("npm pack did not return a tarball name");
  }

  const tarballPath = path.join(baseDir, tarball);

  console.log("[release:smoke] Starting local dependency registry fixture");
  const registryUrl = await startLocalRegistry();
  console.log("[release:smoke] Installing tarball into temporary prefix");
  await runAsync("npm", [
    "install",
    "-g",
    tarballPath,
    "--prefix",
    prefixDir,
    "--cache",
    cacheDir,
    "--registry",
    registryUrl,
    "--no-audit",
    "--no-fund",
  ]);

  const towerBin = path.join(prefixDir, "bin", "tower");
  const installedRoot = path.join(prefixDir, "lib", "node_modules", pkg.name);
  const smokeEnv = {
    ...cleanEnvironment(),
    HOME: homeDir,
    TOWER_DATA_DIR: dataDir,
    NPM_CONFIG_CACHE: cacheDir,
    TOWER_NO_OPEN: "1",
  };
  const version = execFileSync(towerBin, ["--version"], { encoding: "utf8", env: smokeEnv }).trim();
  if (version !== `tower v${pkg.version}`) throw new Error(`Version mismatch: ${version}`);
  const logFd = fs.openSync(logPath, "a");

  console.log("[release:smoke] Starting packaged app");
  child = spawn(towerBin, ["--port", port, "--no-open"], {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: smokeEnv,
  });
  child.unref();
  fs.closeSync(logFd);

  await waitForServer(child.pid);

  const migrationIds = fs.readdirSync(path.join(installedRoot, "scripts", "migrations"))
    .filter((name) => /^\d.*\.(?:ts|mjs|js)$/.test(name))
    .map((name) => name.replace(/\.(?:ts|mjs|js)$/, ""))
    .sort();
  const databaseUrl = `file:${path.join(dataDir, "database", "tower.db")}`;
  const verifyScript = `
    const { PrismaClient } = require('@prisma/client');
    const expected = JSON.parse(process.argv[1]);
    const db = new PrismaClient();
    Promise.all([
      db.appliedMigration.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
      db.providerConnection.findMany({ where: { kind: 'cli' }, select: { connectionKey: true } }),
    ]).then(([migrations, providers]) => {
      const actual = migrations.map((row) => row.id);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Migration ledger mismatch');
      if (!providers.some((row) => row.connectionKey === 'cli:claude')) throw new Error('Built-in provider connection missing');
    }).finally(() => db.$disconnect());
  `;
  execFileSync(process.execPath, ["-e", verifyScript, JSON.stringify(migrationIds)], {
    cwd: installedRoot,
    stdio: "inherit",
    env: { ...smokeEnv, DATABASE_URL: databaseUrl },
  });

  console.log("");
  console.log(`[release:smoke] Ready: http://${host}:${port}`);
  console.log(`[release:smoke] Verified ${migrationIds.length} migrations and built-in provider initialization`);
}

main()
  .catch((error) => {
    console.error(`[release:smoke] Failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopChild();
    await stopRegistry();
    fs.rmSync(baseDir, { recursive: true, force: true });
  });
