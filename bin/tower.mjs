#!/usr/bin/env node

/**
 * Tower CLI — install via npm, run `tower` to start.
 *
 * Usage:
 *   tower                Start server (auto-init on first run)
 *   tower migrate        Migrate data from old project-local paths to ~/.tower
 *   tower service install Install and start the unattended service
 *   tower service status  Inspect the unattended service
 *   tower service remove  Stop and remove the unattended service
 *   tower --help         Show help
 *   tower --version      Show version
 *
 * Options:
 *   -p, --port <port>    Server port (default: 3000)
 *   -H, --host <host>    Server host (default: 127.0.0.1)
 */

import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join, dirname, resolve } from "path";
import { execFileSync, spawn, spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { parseArgs } from "node:util";
import { homedir } from "os";
import { createHash } from "crypto";
import { createRequire } from "module";
import { createConnection } from "net";
import { DEFAULT_HOST, resolveRuntimeNetwork } from "./network.mjs";
import {
  serviceBackend,
  WINDOWS_SERVICE_TASK,
  windowsScheduledTaskCommand,
  windowsServiceScript,
} from "./service.mjs";

// Tower stores local credentials, task content, and SQLite sidecars. A
// restrictive process umask also applies to files created later by Prisma/
// SQLite and to child processes spawned by this CLI.
process.umask(0o077);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

// ─── Data directory: TOWER_DATA_DIR or ~/.tower ───
const TOWER_DIR = process.env.TOWER_DATA_DIR || join(homedir(), ".tower");
const DB_DIR = join(TOWER_DIR, "database");
const DB_PATH = join(DB_DIR, "tower.db");
const DB_URL = `file:${DB_PATH}`;
const SERVICE_LABEL = "org.tower.workbench";
const SERVICE_PLIST = join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
const WINDOWS_SERVICE_DIR = join(TOWER_DIR, "service");
const WINDOWS_SERVICE_SCRIPT = join(WINDOWS_SERVICE_DIR, "tower-service.cmd");

// Pin the resolved data dir + DB URL before anything else. DATABASE_URL pins
// Prisma to this dir; TOWER_DATA_DIR is pinned to the SAME resolved value so a
// later loader cannot inject a stray one. Next's standalone server runs
// loadEnvConfig() on boot, which reads the project-root .env — and this repo's
// .env carries a dev override (TOWER_DATA_DIR=~/.tower-dev). loadEnvConfig never
// overrides an already-set var, so pinning here keeps `pnpm start` on the
// production dir. Without it, getTowerMcpName() reads the leaked .env value and
// the assistant MCP resolves to the dev name (`tower-dev-assistant`) even though
// the server (and its DB) are running in production mode.
process.env.DATABASE_URL = DB_URL;
process.env.TOWER_DATA_DIR = TOWER_DIR;

// ─── Parse CLI args ───
const { values: flags, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    port:    { type: "string", short: "p" },
    host:    { type: "string", short: "H" },
    "no-open": { type: "boolean" },
    help:    { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
  allowPositionals: true,
});

const command = positionals[0] ?? "start";
const PORT = parseInt(flags.port ?? process.env.PORT ?? "3000", 10);
const NETWORK = resolveRuntimeNetwork(flags.host ?? DEFAULT_HOST, PORT);
const HOST = NETWORK.bindHost;

// Next instrumentation runs during app.prepare(), before our HTTP server listens.
// Expose the resolved CLI host/port early so WS startup and origin checks use
// the actual runtime values instead of falling back to 3000/3001.
process.env.PORT = String(PORT);
process.env.HOST = HOST;
process.env.TOWER_RUNTIME_HOST = HOST;

// ─── Help ───
if (flags.help) {
  console.log(`
  Tower — AI Task Orchestration Platform

  Usage:
    tower              Start server (auto-init on first run)
    tower migrate      Migrate data from old project-local paths to ~/.tower
    tower service install
                       Install/start Tower as a macOS LaunchAgent or Windows scheduled task
    tower service status
                       Show unattended service status
    tower service remove
                       Stop and remove the unattended service

  Options:
    -p, --port <port>   Server port (default: 3000)
    -H, --host <host>   Server host (default: 127.0.0.1)
    --no-open           Don't auto-open the browser on start
    -h, --help          Show help
    -v, --version       Show version
  `);
  process.exit(0);
}

// ─── Version ───
if (flags.version) {
  const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf-8"));
  console.log(`tower v${pkg.version}`);
  process.exit(0);
}

// ─── Utilities ───
function log(msg) {
  console.log(`\x1b[36m[tower]\x1b[0m ${msg}`);
}

function logError(msg) {
  console.error(`\x1b[31m[tower]\x1b[0m ${msg}`);
}

function resolveBin(pkgName, binName) {
  const pkgJsonPath = require.resolve(`${pkgName}/package.json`, { paths: [PROJECT_ROOT] });
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  const binField = typeof pkgJson.bin === "string" ? pkgJson.bin : pkgJson.bin?.[binName];

  if (!binField) {
    throw new Error(`No bin entry found for ${pkgName}`);
  }

  return resolve(dirname(pkgJsonPath), binField);
}

function run(binPath, args) {
  try {
    execFileSync(process.execPath, [binPath, ...args], {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: DB_URL },
    });
  } catch {
    logError(`Command failed: ${binPath} ${args.join(" ")}`);
    process.exit(1);
  }
}

function hasGeneratedPrismaClient() {
  const probe = spawnSync(
    process.execPath,
    [
      "-e",
      "const {PrismaClient}=require('@prisma/client'); const prisma=new PrismaClient(); console.log('ok'); prisma.$disconnect();",
    ],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DATABASE_URL: DB_URL },
      encoding: "utf-8",
    }
  );

  if (probe.status === 0) {
    return true;
  }

  const output = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`;
  if (output.includes('@prisma/client did not initialize yet')) {
    return false;
  }

  logError(`Prisma client check failed:\n${output.trim()}`);
  process.exit(1);
}

function needsInit() {
  return !existsSync(DB_PATH);
}

const STATE_FILE = join(TOWER_DIR, ".tower-state.json");

function getSchemaHash() {
  return createHash("sha256")
    .update(readFileSync(join(PROJECT_ROOT, "prisma", "schema.prisma")))
    .digest("hex")
    .slice(0, 16);
}

function readState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  try { chmodSync(STATE_FILE, 0o600); } catch { /* non-POSIX filesystem */ }
}

function ensureDirs() {
  for (const dir of [TOWER_DIR, DB_DIR, join(TOWER_DIR, "storage"), join(TOWER_DIR, "assistant"), join(TOWER_DIR, "logs")]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    try { chmodSync(dir, 0o700); } catch { /* non-POSIX filesystem */ }
  }
  for (const name of ["service.stdout.log", "service.stderr.log"]) {
    const logFile = join(TOWER_DIR, "logs", name);
    if (existsSync(logFile)) {
      try { chmodSync(logFile, 0o600); } catch { /* non-POSIX filesystem */ }
    }
  }
  for (const file of [
    DB_PATH,
    `${DB_PATH}-shm`,
    `${DB_PATH}-wal`,
    STATE_FILE,
    join(TOWER_DIR, "secrets", "internal-api.key"),
  ]) {
    if (existsSync(file)) {
      try { chmodSync(file, 0o600); } catch { /* non-POSIX filesystem */ }
    }
  }
}

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function launchctl(args, options = {}) {
  return spawnSync("launchctl", args, {
    encoding: "utf-8",
    stdio: options.inherit ? "inherit" : "pipe",
  });
}

function serviceDomain() {
  return `gui/${process.getuid()}`;
}

function servicePlist() {
  const values = {
    label: SERVICE_LABEL,
    node: process.execPath,
    cli: __filename,
    cwd: PROJECT_ROOT,
    data: TOWER_DIR,
    port: String(PORT),
    stdout: join(TOWER_DIR, "logs", "service.stdout.log"),
    stderr: join(TOWER_DIR, "logs", "service.stderr.log"),
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xmlEscape(values.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(values.node)}</string>
    <string>${xmlEscape(values.cli)}</string>
    <string>start</string>
    <string>--port</string>
    <string>${xmlEscape(values.port)}</string>
    <string>--host</string>
    <string>127.0.0.1</string>
    <string>--no-open</string>
  </array>
  <key>WorkingDirectory</key><string>${xmlEscape(values.cwd)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TOWER_DATA_DIR</key><string>${xmlEscape(values.data)}</string>
    <key>TOWER_NO_OPEN</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${xmlEscape(values.stdout)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(values.stderr)}</string>
</dict>
</plist>
`;
}

function requireBuiltService() {
  ensureDirs();
  const standaloneServer = join(PROJECT_ROOT, ".next", "standalone", "server.js");
  if (!existsSync(standaloneServer)) {
    logError("Build output is missing. Run `pnpm build` before installing the service.");
    process.exit(1);
  }
}

function cmdMacService(action) {
  const target = `${serviceDomain()}/${SERVICE_LABEL}`;
  if (action === "install") {
    requireBuiltService();
    mkdirSync(dirname(SERVICE_PLIST), { recursive: true });
    writeFileSync(SERVICE_PLIST, servicePlist(), { encoding: "utf-8", mode: 0o600 });
    try { chmodSync(SERVICE_PLIST, 0o600); } catch { /* non-POSIX filesystem */ }
    launchctl(["bootout", target]);
    const loaded = launchctl(["bootstrap", serviceDomain(), SERVICE_PLIST]);
    if (loaded.status !== 0) {
      logError((loaded.stderr || loaded.stdout || "launchctl bootstrap failed").trim());
      process.exit(1);
    }
    const started = launchctl(["kickstart", "-k", target]);
    if (started.status !== 0) {
      logError((started.stderr || started.stdout || "launchctl kickstart failed").trim());
      process.exit(1);
    }
    log(`Unattended service installed and started (${SERVICE_LABEL}).`);
    return;
  }
  if (action === "remove" || action === "uninstall") {
    launchctl(["bootout", target]);
    try {
      unlinkSync(SERVICE_PLIST);
    } catch {
      // Already removed.
    }
    log(`Unattended service removed (${SERVICE_LABEL}).`);
    return;
  }
  if (action === "status") {
    const result = launchctl(["print", target], { inherit: true });
    if (result.status !== 0) {
      logError(`Unattended service is not loaded. Install it with: tower service install`);
      process.exitCode = 1;
    }
    return;
  }
  logError(`Unknown service action: ${action}`);
  process.exit(1);
}

function schtasks(args, options = {}) {
  return spawnSync("schtasks.exe", args, {
    encoding: "utf-8",
    stdio: options.inherit ? "inherit" : "pipe",
    windowsHide: true,
  });
}

function cmdWindowsService(action) {
  if (action === "install") {
    requireBuiltService();
    mkdirSync(WINDOWS_SERVICE_DIR, { recursive: true });
    writeFileSync(
      WINDOWS_SERVICE_SCRIPT,
      windowsServiceScript({
        node: process.execPath,
        cli: __filename,
        cwd: PROJECT_ROOT,
        data: TOWER_DIR,
        port: PORT,
        stdout: join(TOWER_DIR, "logs", "service.stdout.log"),
        stderr: join(TOWER_DIR, "logs", "service.stderr.log"),
      }),
      "utf-8",
    );
    schtasks(["/End", "/TN", WINDOWS_SERVICE_TASK]);
    schtasks(["/Delete", "/TN", WINDOWS_SERVICE_TASK, "/F"]);
    const created = schtasks([
      "/Create",
      "/TN", WINDOWS_SERVICE_TASK,
      "/TR", windowsScheduledTaskCommand(WINDOWS_SERVICE_SCRIPT),
      "/SC", "ONLOGON",
      "/RL", "LIMITED",
      "/F",
    ]);
    if (created.status !== 0) {
      logError((created.stderr || created.stdout || "schtasks create failed").trim());
      process.exit(1);
    }
    const started = schtasks(["/Run", "/TN", WINDOWS_SERVICE_TASK]);
    if (started.status !== 0) {
      logError((started.stderr || started.stdout || "schtasks run failed").trim());
      process.exit(1);
    }
    log(`Unattended service installed and started (${WINDOWS_SERVICE_TASK}, Windows Task Scheduler).`);
    return;
  }
  if (action === "remove" || action === "uninstall") {
    schtasks(["/End", "/TN", WINDOWS_SERVICE_TASK]);
    const removed = schtasks(["/Delete", "/TN", WINDOWS_SERVICE_TASK, "/F"]);
    try { unlinkSync(WINDOWS_SERVICE_SCRIPT); } catch { /* Already removed. */ }
    if (removed.status !== 0 && !/cannot find|找不到/i.test(`${removed.stderr || ""}${removed.stdout || ""}`)) {
      logError((removed.stderr || removed.stdout || "schtasks delete failed").trim());
      process.exit(1);
    }
    log(`Unattended service removed (${WINDOWS_SERVICE_TASK}).`);
    return;
  }
  if (action === "status") {
    const result = schtasks(
      ["/Query", "/TN", WINDOWS_SERVICE_TASK, "/V", "/FO", "LIST"],
      { inherit: true },
    );
    if (result.status !== 0) {
      logError("Unattended service is not registered. Install it with: tower service install");
      process.exitCode = 1;
    }
    return;
  }
  logError(`Unknown service action: ${action}`);
  process.exit(1);
}

function cmdService() {
  const action = positionals[1] ?? "status";
  const backend = serviceBackend(process.platform);
  if (backend === "launchagent") {
    cmdMacService(action);
    return;
  }
  if (backend === "task-scheduler") {
    cmdWindowsService(action);
    return;
  }
  logError("Tower service management supports macOS LaunchAgent and Windows Task Scheduler.");
  process.exit(1);
}

function ensurePrismaClientGenerated() {
  if (hasGeneratedPrismaClient()) {
    return;
  }

  const prismaBin = resolveBin("prisma", "prisma");
  log("Generating Prisma client...");
  run(prismaBin, ["generate", "--schema", "prisma/schema.prisma"]);
}

async function initDatabase() {
  const prismaBin = resolveBin("prisma", "prisma");
  const tsxBin = resolveBin("tsx", "tsx");

  log("Initializing Tower...");
  ensureDirs();
  log(`Data directory: ${TOWER_DIR}`);
  ensurePrismaClientGenerated();

  log("Syncing database schema...");
  run(prismaBin, ["db", "push", "--skip-generate"]);

  log("Seeding initial data...");
  run(tsxBin, ["scripts/init-db.ts"]);

  log("Initializing full-text search...");
  run(tsxBin, ["prisma/init-fts.ts"]);

  writeState({ ...readState(), schemaHash: getSchemaHash() });
  log("Initialization complete!");
}

/**
 * Idempotent schema migration for upgraders.
 *
 * `tower init` only runs when the DB file is absent — users upgrading from an
 * older version retain a stale schema and hit "no such column" errors
 * (issue #6). Gate on a hash of `prisma/schema.prisma` so we only pay the
 * `db push` cost when the schema actually changed.
 *
 * `--accept-data-loss` is needed because `notes_fts*` FTS5 shadow tables are
 * outside the Prisma schema; they get dropped here and rebuilt by init-fts.
 */
function ensureSchemaCurrent() {
  const currentHash = getSchemaHash();
  const state = readState();
  if (state.schemaHash === currentHash) return;

  const prismaBin = resolveBin("prisma", "prisma");
  const tsxBin = resolveBin("tsx", "tsx");

  log("Schema changed — migrating database (this only runs on upgrade)...");

  // FTS5 shadow tables (`notes_fts_config`, `_data`, `_idx`, …) live outside
  // `schema.prisma`; `db push` tries to drop them individually and crashes
  // ("no such table: notes_fts_config") when WAL holds a stale view or the
  // shadows are partially missing. Drop the virtual table up-front so Prisma
  // sees a clean slate, then init-fts rebuilds the index below.
  log("Clearing FTS5 index before schema migration...");
  run(prismaBin, [
    "db", "execute",
    "--file", "prisma/pre-migration.sql",
    "--schema", "prisma/schema.prisma",
  ]);

  run(prismaBin, ["db", "push", "--skip-generate", "--accept-data-loss"]);

  log("Updating builtin labels and defaults...");
  run(tsxBin, ["scripts/init-db.ts"]);

  log("Rebuilding full-text search index...");
  run(tsxBin, ["prisma/init-fts.ts"]);

  writeState({ ...state, schemaHash: currentHash });
  log("Schema migration complete.");
}

// ─── Commands ───
async function cmdMigrate() {
  const tsxBin = resolveBin("tsx", "tsx");
  log("Running data migration...");
  run(tsxBin, ["scripts/migrate-data.ts", "--run"]);
}

async function cmdStart() {
  ensureDirs();
  ensurePrismaClientGenerated();

  // ── Lifecycle: pre-start ── (schema sync + one-shot data migrations)
  await preStart();

  const standaloneDir = join(PROJECT_ROOT, ".next", "standalone");
  const standaloneServer = join(standaloneDir, "server.js");

  if (!existsSync(standaloneServer)) {
    logError(`Standalone server not found at ${standaloneServer}`);
    logError(`The build must run with output: "standalone" in next.config.ts.`);
    process.exit(1);
  }

  // Next.js standalone server reads HOSTNAME (not HOST) for binding.
  process.env.HOSTNAME = HOST;
  // PORT is already set early in this script.
  // Export the package root so code that needs `skills/`, `scripts/`, etc.
  // can find them — `process.cwd()` won't work once we chdir below.
  process.env.TOWER_PACKAGE_ROOT = PROJECT_ROOT;

  log(`Tower starting on ${NETWORK.browserUrl} (bind ${HOST}:${PORT})`);

  // Standalone server expects its own directory as cwd so that
  // `.next/server/`, traced `node_modules/`, and the copied
  // `public/` resolve correctly.
  process.chdir(standaloneDir);

  const browserUrl = NETWORK.browserUrl;

  // ── Lifecycle: post-start ── (fires once the server accepts connections)
  postStart(browserUrl);

  await import(pathToFileURL(standaloneServer).href);
}

/**
 * Pre-start lifecycle phase — everything that must finish before the HTTP
 * server boots. Schema is synced first so data migrations can rely on new
 * columns and the AppliedMigration ledger table existing.
 */
async function preStart() {
  if (needsInit()) {
    await initDatabase();
  } else {
    ensureSchemaCurrent();
  }
  runPendingMigrations();
}

/**
 * Run one-shot data migrations (scripts/migrations/) that haven't been applied
 * to this database yet. Delegated to a tsx runner that tracks applied ids in
 * the AppliedMigration table. A migration failure blocks startup and is
 * retried next start — see scripts/run-migrations.ts.
 */
function runPendingMigrations() {
  const tsxBin = resolveBin("tsx", "tsx");
  run(tsxBin, ["scripts/run-migrations.ts"]);
}

/**
 * Post-start lifecycle phase — runs once the server is accepting connections.
 * Currently opens the browser; this is the place to add future "server is
 * live" actions.
 */
function postStart(url) {
  onServerReady(() => {
    if (shouldOpenBrowser()) openBrowser(url);
  });
}

/**
 * Invoke `onReady` once the HTTP port accepts connections. Polls in the
 * background (up to 15s) so it never blocks server startup. This is the
 * primitive behind the post-start lifecycle phase.
 */
function onServerReady(onReady) {
  const deadline = Date.now() + 15_000;
  const tryProbe = () => {
    const sock = createConnection({ host: NETWORK.connectHost, port: PORT });
    sock.once("connect", () => {
      sock.end();
      onReady();
    });
    sock.once("error", () => {
      sock.destroy();
      if (Date.now() < deadline) {
        setTimeout(tryProbe, 250);
      }
    });
  };
  setTimeout(tryProbe, 250).unref?.();
}

/**
 * Whether to auto-open the browser. Disabled when:
 *   - `--no-open` flag passed
 *   - $TOWER_NO_OPEN / $CI / $NO_BROWSER set
 *   - stdout isn't a TTY (e.g. piped, daemonised, container w/o terminal)
 */
function shouldOpenBrowser() {
  if (flags["no-open"]) return false;
  if (process.env.TOWER_NO_OPEN || process.env.CI || process.env.NO_BROWSER) return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

function openBrowser(url) {
  const platform = process.platform;
  const opener =
    platform === "darwin" ? { cmd: "open", args: [url] } :
    platform === "win32"  ? { cmd: "cmd", args: ["/c", "start", "", url] } :
                            { cmd: "xdg-open", args: [url] };
  try {
    const child = spawn(opener.cmd, opener.args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      log(`Open ${url} in your browser to view Tower.`);
    });
    child.unref();
  } catch {
    log(`Open ${url} in your browser to view Tower.`);
  }
}

// ─── Dispatch ───
switch (command) {
  case "migrate":
    await cmdMigrate();
    break;
  case "service":
    cmdService();
    break;
  case "start":
    await cmdStart();
    break;
  default:
    logError(`Unknown command: ${command}`);
    process.exit(1);
}
