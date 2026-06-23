/**
 * Ensure dev database exists before starting dev server.
 * Runs `prisma db push` + FTS init if the database file is missing.
 * Idempotent — skips if database already exists.
 */
const { existsSync } = require("fs");
const { execFileSync } = require("child_process");
const { resolve } = require("path");

// DATABASE_URL is injected by the `predev` npm script (the dev data dir). Env
// selection lives in package.json, NOT in .env — see .env for why.
const dbUrlEnv = process.env.DATABASE_URL || "";
const dbUrlMatch = dbUrlEnv.match(/^file:(.+)$/);
const dbPath = dbUrlMatch ? dbUrlMatch[1] : "";

if (!dbPath) {
  console.log("[ensure-dev-db] No DATABASE_URL in env, skipping");
  process.exit(0);
}

if (existsSync(dbPath)) {
  process.exit(0);
}

console.log(`[ensure-dev-db] Database not found at ${dbPath}, initializing...`);

try {
  // Create schema
  execFileSync(process.execPath, [
    resolve(__dirname, "..", "node_modules/.bin/prisma"),
    "db", "push", "--accept-data-loss", "--skip-generate",
  ], { stdio: "inherit", env: { ...process.env, DATABASE_URL: `file:${dbPath}` } });

  // Init FTS
  execFileSync(process.execPath, [
    resolve(__dirname, "..", "node_modules/.bin/tsx"),
    resolve(__dirname, "..", "prisma/init-fts.ts"),
  ], { stdio: "inherit", env: { ...process.env, DATABASE_URL: `file:${dbPath}` } });

  console.log("[ensure-dev-db] Dev database initialized successfully");
} catch (err) {
  console.error("[ensure-dev-db] Failed to initialize database:", err.message);
  process.exit(1);
}
