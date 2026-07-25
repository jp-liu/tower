#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This shipped release smoke entrypoint is executed directly as CommonJS. */
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
let upstream = null;
const upstreamRequests = [];

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

function runtimePlatform() {
  return process.platform;
}

async function stopChild() {
  if (!child) return;
  if (child.exitCode !== null) {
    child = null;
    return;
  }
  try {
    if (runtimePlatform() === "win32") {
      execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGTERM");
      if (!await waitForExit(child, 5000)) {
        process.kill(-child.pid, "SIGKILL");
        await waitForExit(child, 5000);
      }
    }
  } catch {}
  child = null;
}

async function stopRegistry() {
  if (!registry) return;
  await new Promise((resolve) => registry.close(resolve));
  registry = null;
}

async function stopUpstream() {
  if (!upstream) return;
  await new Promise((resolve) => upstream.close(resolve));
  upstream = null;
}

async function startFakeAiUpstream() {
  upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      upstreamRequests.push({ url: req.url, authorization: req.headers.authorization, body });
      const content = body.includes("packaged assistant smoke") ? "assistant-ok" : "summary-ok";
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      res.write(`data: ${JSON.stringify({
        id: "chatcmpl-release-smoke",
        object: "chat.completion.chunk",
        created: 1,
        model: "fixture-model",
        choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
      })}\n\n`);
      res.write(`data: ${JSON.stringify({
        id: "chatcmpl-release-smoke",
        object: "chat.completion.chunk",
        created: 1,
        model: "fixture-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, host, resolve);
  });
  const address = upstream.address();
  if (!address || typeof address === "string") throw new Error("Fake AI upstream did not bind a temporary port");
  return `http://${host}:${address.port}/v1`;
}

function requestApp(pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const request = http.request({
      host,
      port: Number(port),
      path: pathname,
      method: payload ? "POST" : "GET",
      headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {},
      timeout: 10_000,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("request timeout")));
    if (payload) request.write(payload);
    request.end();
  });
}

async function preparePackagedAiFixtures(installedRoot, smokeEnv, baseUrl) {
  const fixtureDir = path.join(baseDir, "fixture-provider");
  const projectDir = path.join(baseDir, "fixture-project");
  const fakeBinDir = path.join(baseDir, "fake-bin");
  fs.cpSync(path.join(projectRoot, "packages", "ai-runtime", "test", "fixtures", "valid-plugin"), fixtureDir, {
    recursive: true,
  });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(fakeBinDir, { recursive: true });
  const fakeCli = path.join(fakeBinDir, "fixture-cli");
  fs.writeFileSync(fakeCli, "#!/bin/sh\nprintf 'packaged terminal output\\n'\n");
  fs.chmodSync(fakeCli, 0o700);
  const runtimeUrl = require("url").pathToFileURL(path.join(projectRoot, "packages", "ai-runtime", "dist", "index.js")).href;
  const registerScript = `
    import(process.argv[1]).then(async ({ CliPluginRuntime }) => {
      const runtime = new CliPluginRuntime({ dataRoot: process.argv[2], towerVersion: '0.3.0' });
      const plan = await runtime.planLocalRegistration(process.argv[3]);
      await runtime.registerLocal(plan);
      await runtime.confirmAndEnable(plan.pluginId, plan);
    });
  `;
  execFileSync(process.execPath, ["-e", registerScript, runtimeUrl, dataDir, fixtureDir], {
    cwd: projectRoot,
    stdio: "inherit",
    env: smokeEnv,
  });

  const seedScript = `
    const { PrismaClient } = require('@prisma/client');
    const db = new PrismaClient();
    async function main() {
      await db.workspace.upsert({ where: { id: 'release-workspace' }, create: { id: 'release-workspace', name: 'Release Smoke' }, update: {} });
      await db.project.upsert({
        where: { id: 'release-project' },
        create: { id: 'release-project', name: 'Release Fixture', workspaceId: 'release-workspace', localPath: process.argv[1] },
        update: { localPath: process.argv[1] },
      });
      await db.task.upsert({
        where: { id: 'creleasesmoketask00000001' },
        create: { id: 'creleasesmoketask00000001', title: 'Packaged Terminal', projectId: 'release-project' },
        update: { status: 'TODO' },
      });
      await db.providerConnection.upsert({
        where: { connectionKey: 'cli:@fixture/tower-cli' },
        create: {
          id: 'release-cli', connectionKey: 'cli:@fixture/tower-cli', name: 'Packaged Fixture CLI', kind: 'cli',
          provider: '@fixture/tower-cli', enabled: true, testStatus: 'connected', testOk: true,
          commandOverride: process.argv[2], resolvedCommand: process.argv[2], resolvedVersion: '1.0.0',
        },
        update: { enabled: true, testStatus: 'connected', testOk: true, commandOverride: process.argv[2] },
      });
      await db.providerConnection.upsert({
        where: { id: 'release-api' },
        create: {
          id: 'release-api', name: 'Packaged Fake API', kind: 'api', provider: 'openai-compatible', enabled: true,
          testStatus: 'connected', testOk: true, baseUrl: process.argv[3], defaultModelId: 'fixture-model',
          apiKeys: { create: { id: 'release-key', value: 'release-smoke-key', enabled: true, order: 0, testStatus: 'ok' } },
          models: { create: { id: 'release-model', modelId: 'fixture-model', source: 'manual', available: true } },
        },
        update: { enabled: true, testStatus: 'connected', testOk: true, baseUrl: process.argv[3] },
      });
      for (const slot of ['summary', 'dreaming', 'analysis', 'assistant', 'terminal']) {
        const config = await db.aiCapabilityConfig.upsert({
          where: { slot }, create: { slot, migrationStatus: 'complete' }, update: { migrationStatus: 'complete' },
        });
        await db.aiCapabilityTarget.deleteMany({ where: { capabilityConfigId: config.id } });
        const terminal = slot === 'terminal';
        await db.aiCapabilityTarget.create({ data: {
          capabilityConfigId: config.id,
          connectionId: terminal ? 'release-cli' : 'release-api',
          modelId: terminal ? 'fixture' : 'fixture-model',
          targetKey: terminal ? 'release-cli:fixture' : 'release-api:fixture-model',
          order: 0,
        } });
      }
    }
    main().finally(() => db.$disconnect());
  `;
  execFileSync(process.execPath, ["-e", seedScript, projectDir, fakeCli, baseUrl], {
    cwd: installedRoot,
    stdio: "inherit",
    env: { ...smokeEnv, DATABASE_URL: `file:${path.join(dataDir, "database", "tower.db")}` },
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

async function startPackagedApp(towerBin, smokeEnv) {
  const logFd = fs.openSync(logPath, "a");
  child = spawn(towerBin, ["--port", port, "--no-open"], {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: smokeEnv,
  });
  child.unref();
  fs.closeSync(logFd);
  await waitForServer(child.pid);
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
  console.log("[release:smoke] Starting packaged app");
  await startPackagedApp(towerBin, smokeEnv);

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

  console.log("[release:smoke] Preparing packaged fixture plugin and explicit capability plans");
  const fakeAiBaseUrl = await startFakeAiUpstream();
  await preparePackagedAiFixtures(installedRoot, smokeEnv, fakeAiBaseUrl);
  smokeEnv.PATH = `${path.join(baseDir, "fake-bin")}${path.delimiter}${smokeEnv.PATH ?? ""}`;
  await stopChild();
  await startPackagedApp(towerBin, smokeEnv);

  const assistant = await requestApp("/api/internal/assistant/chat", {
    message: "packaged assistant smoke",
    clientTurnId: "release_smoke_12345678",
  });
  if (assistant.status !== 200 || !assistant.body.includes("assistant-ok") || !assistant.body.includes('"type":"done"')) {
    throw new Error(`Packaged Assistant smoke failed (${assistant.status}): ${assistant.body.slice(-1000)}`);
  }

  const terminal = await requestApp("/api/internal/terminal/creleasesmoketask00000001/start", { prompt: "packaged terminal smoke" });
  if (terminal.status !== 200) {
    const diagnosticScript = `
      const { PrismaClient } = require('@prisma/client');
      const db = new PrismaClient();
      Promise.all([
        db.taskExecution.findMany({ where: { taskId: 'creleasesmoketask00000001' }, orderBy: { createdAt: 'desc' }, take: 2 }),
        db.aiCapabilityAttempt.findMany({ where: { slot: 'terminal' }, orderBy: { createdAt: 'desc' }, take: 5 }),
      ]).then((rows) => process.stdout.write(JSON.stringify(rows))).finally(() => db.$disconnect());
    `;
    const diagnostics = execFileSync(process.execPath, ["-e", diagnosticScript], {
      cwd: installedRoot,
      encoding: "utf8",
      env: { ...smokeEnv, DATABASE_URL: databaseUrl },
    });
    throw new Error(`Packaged Terminal smoke failed (${terminal.status}): ${terminal.body}; diagnostics=${diagnostics}`);
  }
  const terminalBinding = JSON.parse(terminal.body);
  if (terminalBinding.connectionId !== "release-cli" || terminalBinding.modelId !== "fixture" || !terminalBinding.targetId) {
    throw new Error(`Packaged Terminal binding mismatch: ${terminal.body}`);
  }

  const summaryDeadline = Date.now() + 20_000;
  while (Date.now() < summaryDeadline && !upstreamRequests.some((request) => request.body.includes("packaged terminal output"))) {
    await wait(250);
  }
  const assistantRequest = upstreamRequests.find((request) => request.body.includes("packaged assistant smoke"));
  const summaryRequest = upstreamRequests.find((request) => request.body.includes("packaged terminal output"));
  if (!assistantRequest || !summaryRequest) {
    throw new Error(`Packaged capability requests missing: assistant=${Boolean(assistantRequest)} summary=${Boolean(summaryRequest)}`);
  }
  if (assistantRequest.authorization !== "Bearer release-smoke-key" || summaryRequest.authorization !== "Bearer release-smoke-key") {
    throw new Error("Packaged API connection did not use the restored explicit Key");
  }

  console.log("");
  console.log(`[release:smoke] Ready: http://${host}:${port}`);
  console.log(`[release:smoke] Verified ${migrationIds.length} migrations, fixture plugin, API, Summary, Assistant, and Terminal plans`);
}

main()
  .catch((error) => {
    console.error(`[release:smoke] Failed: ${error.message}`);
    if (fs.existsSync(logPath)) {
      console.error(`[release:smoke] Log tail:\n${fs.readFileSync(logPath, "utf8").slice(-4000)}`);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopChild();
    await stopUpstream();
    await stopRegistry();
    fs.rmSync(baseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
