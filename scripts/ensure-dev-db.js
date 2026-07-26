/* eslint-disable @typescript-eslint/no-require-imports -- This predev script is invoked directly by Node as CommonJS. */
/**
 * Ensure dev database exists before starting dev server.
 * Runs `prisma db push` + FTS init if the database file is missing.
 * Idempotent — skips if database already exists.
 */
const { existsSync, mkdirSync } = require("fs");
const { execFileSync } = require("child_process");
const { dirname, resolve } = require("path");

const packageRoot = resolve(__dirname, "..");

function resolvePackageBin(packageName, binName) {
  const pkgJsonPath = require.resolve(`${packageName}/package.json`, { paths: [packageRoot] });
  const pkgJson = require(pkgJsonPath);
  const binField = typeof pkgJson.bin === "string" ? pkgJson.bin : pkgJson.bin?.[binName];

  if (!binField) {
    throw new Error(`No ${binName} bin entry found in ${packageName}`);
  }

  return resolve(dirname(pkgJsonPath), binField);
}

// DATABASE_URL is injected by the `predev` npm script (the dev data dir). Env
// selection lives in package.json, NOT in .env — see .env for why.
function main() {
  const dbUrlEnv = process.env.DATABASE_URL || "";
  const dbUrlMatch = dbUrlEnv.match(/^file:(.+)$/);
  const dbPath = dbUrlMatch ? dbUrlMatch[1] : "";

  if (!dbPath) {
    console.log("[ensure-dev-db] No DATABASE_URL in env, skipping");
    return;
  }

  if (existsSync(dbPath)) {
    return;
  }

  console.log(`[ensure-dev-db] Database not found at ${dbPath}, initializing...`);
  mkdirSync(dirname(dbPath), { recursive: true });

  try {
    // Create schema
    execFileSync(process.execPath, [
      resolvePackageBin("prisma", "prisma"),
      "db", "push", "--accept-data-loss", "--skip-generate",
    ], { stdio: "inherit", env: { ...process.env, DATABASE_URL: `file:${dbPath}` } });

    // Init FTS
    execFileSync(process.execPath, [
      resolvePackageBin("tsx", "tsx"),
      resolve(packageRoot, "prisma/init-fts.ts"),
    ], { stdio: "inherit", env: { ...process.env, DATABASE_URL: `file:${dbPath}` } });

    console.log("[ensure-dev-db] Dev database initialized successfully");
  } catch (err) {
    console.error("[ensure-dev-db] Failed to initialize database:", err.message);
    process.exitCode = 1;
  }
}

module.exports = { resolvePackageBin };

if (require.main === module) main();
