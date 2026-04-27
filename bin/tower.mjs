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
import { execSync, spawn } from "child_process";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

// ─── Data directory: ~/.tower ───
const TOWER_DIR = join(homedir(), ".tower");
const DB_DIR = join(TOWER_DIR, "database");
const DB_PATH = join(DB_DIR, "tower.db");
const DB_URL = `file:${DB_PATH}`;

// ─── Parse CLI args ───
import { parseArgs } from "node:util";

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

const PORT = flags.port ?? process.env.PORT ?? "3000";
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

function childEnv() {
  return { ...process.env, DATABASE_URL: DB_URL };
}

function run(cmd, opts = {}) {
  try {
    execSync(cmd, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      env: childEnv(),
      ...opts,
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

  log("Generating Prisma client...");
  run("npx prisma generate");

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

  // Use standalone server.js if available (npm install), fallback to next start (dev)
  const standaloneServer = join(PROJECT_ROOT, ".next", "standalone", "tower", "server.js");
  const useStandalone = existsSync(standaloneServer);

  log(`Starting Tower on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  const child = useStandalone
    ? spawn("node", [standaloneServer], {
        cwd: join(PROJECT_ROOT, ".next", "standalone", "tower"),
        stdio: "inherit",
        env: { ...childEnv(), PORT, HOSTNAME: HOST },
      })
    : spawn("npx", ["next", "start", "-p", PORT, "-H", HOST], {
        cwd: PROJECT_ROOT,
        stdio: "inherit",
        env: childEnv(),
      });

  child.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
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
