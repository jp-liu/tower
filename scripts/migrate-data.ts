/**
 * Migrate data from old project-local paths to ~/.tower/
 *
 * Old layout (project root):
 *   prisma/dev.db        → ~/.tower/database/tower.db
 *   data/assets/          → ~/.tower/storage/assets/
 *   data/cache/           → ~/.tower/storage/cache/
 *
 * Usage:
 *   npx tsx scripts/migrate-data.ts          # dry-run (preview only)
 *   npx tsx scripts/migrate-data.ts --run    # actually migrate
 */

import { existsSync, cpSync, copyFileSync, mkdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const PROJECT_ROOT = process.cwd();
const TOWER_DIR = join(homedir(), ".tower");
const dryRun = !process.argv.includes("--run");

function log(msg: string) {
  console.log(`${dryRun ? "[dry-run] " : ""}${msg}`);
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    if (!dryRun) mkdirSync(dir, { recursive: true });
    log(`mkdir ${dir}`);
  }
}

function migrateFile(src: string, dest: string) {
  if (!existsSync(src)) return false;
  if (existsSync(dest)) {
    const srcSize = statSync(src).size;
    const destSize = statSync(dest).size;
    log(`SKIP ${src} → ${dest} (destination exists, src=${srcSize}B, dest=${destSize}B)`);
    return false;
  }
  ensureDir(join(dest, "..").replace(/\/\.\.$/, ""));
  if (!dryRun) copyFileSync(src, dest);
  log(`COPY ${src} → ${dest}`);
  return true;
}

function migrateDir(src: string, dest: string) {
  if (!existsSync(src)) return false;
  if (existsSync(dest)) {
    log(`SKIP ${src} → ${dest} (destination exists)`);
    return false;
  }
  ensureDir(join(dest, ".."));
  if (!dryRun) cpSync(src, dest, { recursive: true });
  log(`COPY ${src}/ → ${dest}/`);
  return true;
}

// ─── Main ───
console.log(`\nTower Data Migration${dryRun ? " (DRY RUN — add --run to execute)" : ""}\n`);
console.log(`Source: ${PROJECT_ROOT}`);
console.log(`Target: ${TOWER_DIR}\n`);

let migrated = 0;

// Ensure target dirs
ensureDir(join(TOWER_DIR, "database"));
ensureDir(join(TOWER_DIR, "storage"));
ensureDir(join(TOWER_DIR, "assistant"));
ensureDir(join(TOWER_DIR, "logs"));

// 1. Database
const dbSrc = join(PROJECT_ROOT, "prisma", "dev.db");
if (migrateFile(dbSrc, join(TOWER_DIR, "database", "tower.db"))) migrated++;

// Also copy WAL/SHM if they exist (SQLite journal files)
for (const suffix of ["-wal", "-shm", "-journal"]) {
  migrateFile(dbSrc + suffix, join(TOWER_DIR, "database", `tower.db${suffix}`));
}

// 2. Assets
const assetsSrc = join(PROJECT_ROOT, "data", "assets");
if (migrateDir(assetsSrc, join(TOWER_DIR, "storage", "assets"))) migrated++;

// 3. Cache
const cacheSrc = join(PROJECT_ROOT, "data", "cache");
if (migrateDir(cacheSrc, join(TOWER_DIR, "storage", "cache"))) migrated++;

// Summary
console.log(`\n${migrated > 0 ? `${migrated} item(s) migrated.` : "Nothing to migrate."}`);

if (dryRun && migrated > 0) {
  console.log("\nRe-run with --run to execute the migration:");
  console.log("  npx tsx scripts/migrate-data.ts --run\n");
}

if (!dryRun && migrated > 0) {
  console.log("\nMigration complete. You can now start Tower with:");
  console.log("  tower dev\n");
  console.log("Old files were NOT deleted. Remove them manually after verifying:");
  console.log(`  rm -rf ${dbSrc} ${assetsSrc} ${cacheSrc}\n`);
}
