#!/usr/bin/env node
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const projectRoot = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
const port = process.env.TOWER_SMOKE_PORT || "4010";
const host = "127.0.0.1";
const stamp = `${Date.now()}`;
const baseDir = path.join(os.tmpdir(), `tower-smoke-${stamp}`);
const prefixDir = path.join(baseDir, "prefix");
const cacheDir = path.join(baseDir, "npm-cache");
const homeDir = path.join(baseDir, "home");
const logPath = path.join(baseDir, "tower.log");

fs.mkdirSync(prefixDir, { recursive: true });
fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(homeDir, { recursive: true });

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
  console.log(`[release:smoke] Building ${pkg.name}@${pkg.version}`);
  run("pnpm", ["build"]);

  console.log("[release:smoke] Packing tarball");
  const tarball = execFileSync("npm", ["pack", "--cache", cacheDir], {
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

  const tarballPath = path.join(projectRoot, tarball);

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
  const logFd = fs.openSync(logPath, "a");

  console.log("[release:smoke] Starting packaged app");
  const child = spawn(towerBin, ["--host", host, "--port", port], {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      HOME: homeDir,
      NPM_CONFIG_CACHE: cacheDir,
    },
  });
  child.unref();
  fs.closeSync(logFd);

  await waitForServer(child.pid);

  console.log("");
  console.log(`[release:smoke] Ready: http://${host}:${port}`);
  console.log(`[release:smoke] PID: ${child.pid}`);
  console.log(`[release:smoke] Log: ${logPath}`);
  console.log(`[release:smoke] Stop: kill ${child.pid}`);
}

main().catch((error) => {
  console.error(`[release:smoke] Failed: ${error.message}`);
  process.exit(1);
});
