#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Platform archive smoke runner. */
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { assertPortableRoot } = require("./release-portable-canary.js");
const { isLinux, isWindows } = require("./release-platform.js");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function findPort() {
  return new Promise((resolve, reject) => {
    const server = require("node:net").createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHttp(port, child, logPath) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const status = await new Promise((resolve, reject) => {
        const request = http.get({ host: "127.0.0.1", port, path: "/", timeout: 2000 }, (response) => {
          response.resume();
          resolve(response.statusCode || 0);
        });
        request.once("error", reject);
        request.once("timeout", () => request.destroy(new Error("timeout")));
      });
      if (status > 0) return;
    } catch {}
    await wait(500);
  }
  const logs = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8").slice(-6000) : "(no logs)";
  throw new Error(`portable Tower did not start\n${logs}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (isWindows()) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), wait(5000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

function poisonNetworkEnv(dataDir, proxyUrl) {
  return {
    ...process.env,
    HOME: path.join(dataDir, "home"),
    USERPROFILE: path.join(dataDir, "home"),
    TOWER_DATA_DIR: path.join(dataDir, "tower-data"),
    TOWER_NO_OPEN: "1",
    CI: "1",
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    all_proxy: proxyUrl,
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
    PRISMA_ENGINES_MIRROR: `${proxyUrl}/blocked-prisma-engines`,
    npm_config_registry: `${proxyUrl}/blocked-npm-registry`,
    npm_config_offline: "true",
  };
}

function createNativeProbeSource() {
  return `
    const path = require('node:path');
    const { createRequire } = require('node:module');
    const root = process.argv[1];
    const localRequire = createRequire(path.join(root, 'package.json'));
    const { PrismaClient } = localRequire('@prisma/client');
    const pty = localRequire('node-pty');
    const ripgrep = localRequire('@vscode/ripgrep');
    if (!ripgrep.rgPath || !require('node:fs').existsSync(ripgrep.rgPath)) throw new Error('ripgrep binary missing');
    const child = pty.spawn(process.execPath, ['-e', 'process.stdout.write("pty-ok")'], { cols: 80, rows: 24 });
    let output = '';
    child.onData((data) => { output += data; });
    child.onExit(() => {
      void (async () => {
        if (!output.includes('pty-ok')) throw new Error('node-pty output missing');
        const db = new PrismaClient();
        await db.$connect();
        await db.$disconnect();
        process.stdout.write('native-ok', () => process.exit(0));
      })().catch((error) => {
        const message = error && error.stack ? error.stack : String(error);
        process.stderr.write(message + '\\n', () => process.exit(1));
      });
    });
  `;
}

async function main() {
  const root = option("--root");
  if (!root) throw new Error("Usage: node scripts/release-portable-smoke.js --root DIR");
  let portableRoot = path.resolve(root);
  if (!fs.existsSync(path.join(portableRoot, "portable-manifest.json"))) {
    const candidates = fs.readdirSync(portableRoot)
      .map((name) => path.join(portableRoot, name))
      .filter((candidate) => fs.statSync(candidate).isDirectory() && fs.existsSync(path.join(candidate, "portable-manifest.json")));
    if (candidates.length !== 1) throw new Error(`expected one extracted portable root in ${portableRoot}`);
    portableRoot = candidates[0];
  }
  const result = assertPortableRoot(portableRoot);
  const packageRoot = result.packageRoot;
  const cli = path.join(packageRoot, "bin", "tower.mjs");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tower-portable-smoke-"));
  const logPath = path.join(temporary, "tower.log");
  let tower = null;
  let proxy = null;
  let blockedRequests = 0;
  try {
    fs.mkdirSync(path.join(temporary, "home"), { recursive: true });
    proxy = http.createServer((request, response) => {
      blockedRequests++;
      request.resume();
      response.writeHead(502, { "content-type": "text/plain" });
      response.end("network disabled by release portable smoke");
    });
    await new Promise((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(0, "127.0.0.1", resolve);
    });
    const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
    const env = poisonNetworkEnv(temporary, proxyUrl);

    const nativeProbe = createNativeProbeSource();

    const port = await findPort();
    const log = fs.openSync(logPath, "a");
    tower = spawn(process.execPath, [cli, "--port", String(port), "--host", "127.0.0.1", "--no-open"], {
      cwd: packageRoot,
      env,
      stdio: ["ignore", log, log],
    });
    fs.closeSync(log);
    await waitForHttp(port, tower, logPath);
    await stop(tower);
    tower = null;

    const statePath = path.join(env.TOWER_DATA_DIR, ".tower-state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    fs.writeFileSync(statePath, `${JSON.stringify({ ...state, schemaHash: "portable-smoke-stale" }, null, 2)}\n`);
    const upgradePort = await findPort();
    const upgradeLog = fs.openSync(logPath, "a");
    tower = spawn(process.execPath, [cli, "--port", String(upgradePort), "--host", "127.0.0.1", "--no-open"], {
      cwd: packageRoot,
      env,
      stdio: ["ignore", upgradeLog, upgradeLog],
    });
    fs.closeSync(upgradeLog);
    await waitForHttp(upgradePort, tower, logPath);
    await stop(tower);
    tower = null;

    const native = spawnSync(process.execPath, ["-e", nativeProbe, packageRoot], {
      cwd: packageRoot,
      env: { ...env, DATABASE_URL: `file:${path.join(env.TOWER_DATA_DIR, "database", "tower.db")}` },
      encoding: "utf8",
      timeout: 30_000,
    });
    if (native.status !== 0 || !native.stdout.includes("native-ok")) {
      throw new Error(`native runtime probe failed: ${native.stderr || native.stdout}`);
    }

    const migrationProbe = `
      const path = require('node:path');
      const { createRequire } = require('node:module');
      const localRequire = createRequire(path.join(process.argv[1], 'package.json'));
      const { PrismaClient } = localRequire('@prisma/client');
      const db = new PrismaClient();
      db.appliedMigration.count().then((count) => {
        if (count < 1) throw new Error('migration ledger is empty');
        process.stdout.write(String(count));
      }).finally(() => db.$disconnect());
    `;
    const migrations = spawnSync(process.execPath, ["-e", migrationProbe, packageRoot], {
      cwd: packageRoot,
      env: { ...env, DATABASE_URL: `file:${path.join(env.TOWER_DATA_DIR, "database", "tower.db")}` },
      encoding: "utf8",
      timeout: 30_000,
    });
    if (migrations.status !== 0 || Number(migrations.stdout) < 1) throw new Error(`migration probe failed: ${migrations.stderr}`);

    const mcp = spawn(process.execPath, [path.join(packageRoot, "dist", "mcp-server.cjs")], {
      cwd: packageRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let mcpOutput = "";
    let mcpError = "";
    mcp.stdout.on("data", (chunk) => { mcpOutput += chunk; });
    mcp.stderr.on("data", (chunk) => { mcpError += chunk; });
    mcp.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "portable-smoke", version: "1" } } })}\n`);
    const mcpDeadline = Date.now() + 20_000;
    while (!mcpOutput.includes('"id":1') && Date.now() < mcpDeadline && mcp.exitCode === null) await wait(100);
    await stop(mcp);
    if (!mcpOutput.includes('"id":1')) throw new Error(`MCP initialize failed: ${mcpError || mcpOutput}`);

    const help = spawnSync(process.execPath, [cli, "--help"], { cwd: packageRoot, env, encoding: "utf8" });
    if (help.status !== 0 || !help.stdout.includes("tower service install")) throw new Error("tower service help boundary missing");
    const service = spawnSync(process.execPath, [cli, "service", "status"], { cwd: packageRoot, env, encoding: "utf8" });
    const serviceOutput = `${service.stdout || ""}\n${service.stderr || ""}`;
    if (isLinux()) {
      if (service.status === 0 || !serviceOutput.includes("supports macOS LaunchAgent and Windows Task Scheduler")) {
        throw new Error(`Linux service boundary failed: ${serviceOutput}`);
      }
    } else if (![0, 1].includes(service.status)) {
      throw new Error(`service status probe failed: ${serviceOutput}`);
    }
    if (blockedRequests !== 0) throw new Error(`portable runtime attempted ${blockedRequests} blocked network request(s)`);
    console.log(`[release:portable:smoke] ${result.manifest.platform}-${result.manifest.arch}: first start, schema upgrade, ${migrations.stdout.trim()} migrations, Prisma, MCP, node-pty, ripgrep, service boundary; registry/CDN requests=0`);
  } finally {
    await stop(tower);
    if (proxy) await new Promise((resolve) => proxy.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

module.exports = { createNativeProbeSource };
if (require.main === module) {
  main().catch((error) => { console.error(`[release:portable:smoke] ${error.message}`); process.exit(1); });
}
