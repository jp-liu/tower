#!/usr/bin/env node

/**
 * Tower CLI — install via npm, run `tower` to start.
 *
 * Usage:
 *   tower                Start server (auto-init on first run)
 *   tower migrate        Migrate data from old project-local paths to ~/.tower
 *   tower --help         Show help
 *   tower --version      Show version
 *
 * Options:
 *   -p, --port <port>    Server port (default: 3000)
 *   -H, --host <host>    Server host (default: 0.0.0.0)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { execFileSync, spawn, spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { parseArgs } from "node:util";
import { homedir } from "os";
import { createHash } from "crypto";
import { createRequire } from "module";
import { createConnection } from "net";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

// ─── Data directory: TOWER_DATA_DIR or ~/.tower ───
const TOWER_DIR = process.env.TOWER_DATA_DIR || join(homedir(), ".tower");
const DB_DIR = join(TOWER_DIR, "database");
const DB_PATH = join(DB_DIR, "tower.db");
const DB_URL = `file:${DB_PATH}`;

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
const HOST = flags.host ?? "0.0.0.0";

// Next instrumentation runs during app.prepare(), before our HTTP server listens.
// Expose the resolved CLI host/port early so WS startup and origin checks use
// the actual runtime values instead of falling back to 3000/3001.
process.env.PORT = String(PORT);
process.env.HOST = HOST;

// ─── Help ───
if (flags.help) {
  console.log(`
  Tower — AI Task Orchestration Platform

  Usage:
    tower              Start server (auto-init on first run)
    tower migrate      Migrate data from old project-local paths to ~/.tower

  Options:
    -p, --port <port>   Server port (default: 3000)
    -H, --host <host>   Server host (default: 0.0.0.0)
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
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function ensureDirs() {
  for (const dir of [TOWER_DIR, DB_DIR, join(TOWER_DIR, "storage"), join(TOWER_DIR, "assistant"), join(TOWER_DIR, "logs")]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
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

  log(`Tower starting on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);

  // Standalone server expects its own directory as cwd so that
  // `.next/server/`, traced `node_modules/`, and the copied
  // `public/` resolve correctly.
  process.chdir(standaloneDir);

  const browserUrl = `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;

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
 * the AppliedMigration table. A migration failure is non-fatal (logged +
 * retried next start) — see scripts/run-migrations.ts.
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
  const probeHost = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;

  const tryProbe = () => {
    const sock = createConnection({ host: probeHost, port: PORT });
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
  case "start":
    await cmdStart();
    break;
  default:
    logError(`Unknown command: ${command}`);
    process.exit(1);
}
