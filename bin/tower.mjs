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

import { existsSync, readFileSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { execSync } from "child_process";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { parseArgs } from "node:util";
import { homedir } from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

// ─── Data directory: ~/.tower ───
const TOWER_DIR = join(homedir(), ".tower");
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

function run(cmd) {
  try {
    execSync(cmd, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: DB_URL },
    });
  } catch {
    logError(`Command failed: ${cmd}`);
    process.exit(1);
  }
}

function needsInit() {
  return !existsSync(DB_PATH);
}

function ensureDirs() {
  for (const dir of [TOWER_DIR, DB_DIR, join(TOWER_DIR, "storage"), join(TOWER_DIR, "assistant"), join(TOWER_DIR, "logs")]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

async function initDatabase() {
  log("Initializing Tower...");
  ensureDirs();
  log(`Data directory: ${TOWER_DIR}`);

  log("Syncing database schema...");
  run("npx prisma db push --skip-generate");

  log("Seeding initial data...");
  run("npx tsx scripts/init-db.ts");

  log("Initializing full-text search...");
  run("npx tsx prisma/init-fts.ts");

  log("Initialization complete!");
}

// ─── Commands ───
async function cmdMigrate() {
  log("Running data migration...");
  run("npx tsx scripts/migrate-data.ts --run");
}

async function cmdStart() {
  if (needsInit()) {
    await initDatabase();
  }

  // Use Next.js programmatic API (same approach as nextra, tldraw)
  const next = (await import("next")).default;
  const app = next({
    dev: false,
    dir: PROJECT_ROOT,
    quiet: false,
  });

  const handle = app.getRequestHandler();
  await app.prepare();

  const server = createServer(handle);
  server.listen(PORT, HOST, () => {
    log(`Tower running on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  });
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
