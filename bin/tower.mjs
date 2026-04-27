#!/usr/bin/env node

/**
 * Tower CLI — install via npm, run `tower` to start.
 *
 * Usage:
 *   tower              Start production server (auto-init on first run)
 *   tower dev           Start development server
 *   tower init          Initialize database only (no server start)
 *   tower build         Build for production
 *   tower --help        Show help
 *   tower --version     Show version
 *
 * Options:
 *   -p, --port <port>   Server port (default: 3000)
 *   -H, --host <host>   Server host (default: 0.0.0.0)
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
const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("-")) ?? "start";
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith("-"))
    .reduce((acc, arg) => {
      if (arg === "-p" || arg === "--port") {
        const next = args[args.indexOf(arg) + 1];
        if (next && !next.startsWith("-")) acc.push(["port", next]);
      } else if (arg === "-H" || arg === "--host") {
        const next = args[args.indexOf(arg) + 1];
        if (next && !next.startsWith("-")) acc.push(["host", next]);
      } else if (arg === "--help" || arg === "-h") {
        acc.push(["help", "true"]);
      } else if (arg === "--version" || arg === "-v") {
        acc.push(["version", "true"]);
      }
      return acc;
    }, [])
);

const PORT = flags.port ?? process.env.PORT ?? "3000";
const HOST = flags.host ?? "0.0.0.0";

// ─── Help ───
if (flags.help) {
  console.log(`
  Tower — AI Task Orchestration Platform

  Usage:
    tower              Start production server (auto-init on first run)
    tower dev           Start development server
    tower init          Initialize database only
    tower build         Build for production

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

/** Shared env for all child processes — DATABASE_URL always points to ~/.tower/database/tower.db */
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

// ─── Ensure directory structure ───
function ensureDirs() {
  for (const dir of [TOWER_DIR, DB_DIR, join(TOWER_DIR, "storage"), join(TOWER_DIR, "assistant"), join(TOWER_DIR, "logs")]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

// ─── Initialize database ───
async function initDatabase() {
  log("Initializing Tower...");
  ensureDirs();
  log(`Data directory: ${TOWER_DIR}`);

  // Generate Prisma client
  log("Generating Prisma client...");
  run("npx prisma generate");

  // Push schema to database
  log("Syncing database schema...");
  run("npx prisma db push --skip-generate");

  // Seed builtin data (labels, default config, default workspace)
  log("Seeding initial data...");
  run("npx tsx scripts/init-db.ts");

  // Initialize FTS virtual table
  log("Initializing full-text search...");
  run("npx tsx prisma/init-fts.ts");

  log("Initialization complete!");
}

// ─── Commands ───
async function cmdInit() {
  await initDatabase();
}

async function cmdDev() {
  if (needsInit()) {
    await initDatabase();
  }

  log(`Starting development server on port ${PORT}...`);
  const child = spawn("npx", ["next", "dev", "--webpack", "-p", PORT, "-H", HOST], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: childEnv(),
  });

  child.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

async function cmdBuild() {
  if (needsInit()) {
    await initDatabase();
  }

  log("Building for production...");
  run("npx next build");
  log("Build complete!");
}

async function cmdStart() {
  if (needsInit()) {
    await initDatabase();
  }

  // Check if build exists
  const nextDir = join(PROJECT_ROOT, ".next");
  if (!existsSync(nextDir)) {
    log("No build found, building first...");
    run("npx next build");
  }

  log(`Starting Tower on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  const child = spawn("npx", ["next", "start", "-p", PORT, "-H", HOST], {
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
  case "init":
    await cmdInit();
    break;
  case "dev":
    await cmdDev();
    break;
  case "build":
    await cmdBuild();
    break;
  case "start":
    await cmdStart();
    break;
  default:
    logError(`Unknown command: ${command}`);
    process.exit(1);
}
