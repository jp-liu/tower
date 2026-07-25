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

fs.mkdirSync(prefixDir, { recursive: true });
fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(homeDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

let child = null;

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
    ...options,
  });
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

  console.log("[release:smoke] Installing tarball into temporary prefix");
  run("npm", [
    "install",
    "-g",
    tarballPath,
    "--prefix",
    prefixDir,
    "--cache",
    cacheDir,
  ]);

  const towerBin = path.join(prefixDir, "bin", "tower");
  const installedRoot = path.join(prefixDir, "lib", "node_modules", pkg.name);
  const smokeEnv = {
    ...process.env,
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
    fs.rmSync(baseDir, { recursive: true, force: true });
  });
