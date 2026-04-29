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
import { execFileSync, spawnSync } from "child_process";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { parseArgs } from "node:util";
import { homedir } from "os";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

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

  log("Initialization complete!");
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
  }

  // Next.js resolves paths relative to process.cwd().
  // On Windows, if cwd is on a different drive (e.g. C:\) than the package
  // (e.g. E:\), path.resolve produces an invalid concatenation.
  // Fix: set cwd to PROJECT_ROOT before starting Next.js.
  process.chdir(PROJECT_ROOT);

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
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`Received ${signal}, shutting down...`);

    const forceExitTimer = setTimeout(() => {
      process.exit(0);
    }, 2000);
    forceExitTimer.unref();

    server.close(() => {
      process.exit(0);
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

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
