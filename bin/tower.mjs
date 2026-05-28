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
import { execFileSync, spawnSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { parseArgs } from "node:util";
import { homedir } from "os";
import { createHash } from "crypto";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

// ─── Data directory: TOWER_DATA_DIR or ~/.tower ───
const TOWER_DIR = process.env.TOWER_DATA_DIR || join(homedir(), ".tower");
const DB_DIR = join(TOWER_DIR, "database");
const DB_PATH = join(DB_DIR, "tower.db");
const DB_URL = `file:${DB_PATH}`;

// Set DATABASE_URL before anything else
process.env.DATABASE_URL = DB_URL;

// ─── Parse CLI args ───
const { values: flags, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    port:    { type: "string", short: "p" },
    host:    { type: "string", short: "H" },
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

  if (needsInit()) {
    await initDatabase();
  } else {
    ensureSchemaCurrent();
  }

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

  log(`Tower starting on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);

  // Standalone server expects its own directory as cwd so that
  // `.next/server/`, traced `node_modules/`, and the copied
  // `public/` resolve correctly.
  process.chdir(standaloneDir);

  await import(pathToFileURL(standaloneServer).href);
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
