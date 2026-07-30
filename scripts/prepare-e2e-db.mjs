#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.TOWER_DATA_DIR
  ? path.resolve(process.env.TOWER_DATA_DIR)
  : "";
const tmpRoot = path.resolve(os.tmpdir());

if (
  !dataDir ||
  !dataDir.startsWith(`${tmpRoot}${path.sep}`) ||
  !path.basename(dataDir).startsWith("tower-e2e-")
) {
  throw new Error(
    `Refusing to prepare E2E data at ${dataDir || "(unset)"}; ` +
      `TOWER_DATA_DIR must be a tower-e2e-* directory under ${tmpRoot}.`,
  );
}

const databaseDir = path.join(dataDir, "database");
const databasePath = path.join(databaseDir, "tower.db");
const databaseUrl = `file:${databasePath}`;
const prisma = path.join(projectRoot, "node_modules", ".bin", "prisma");
const tsx = path.join(projectRoot, "node_modules", ".bin", "tsx");
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  TOWER_DATA_DIR: dataDir,
};

rmSync(dataDir, { recursive: true, force: true });
mkdirSync(databaseDir, { recursive: true });
closeSync(openSync(databasePath, "a"));

execFileSync(prisma, ["db", "push", "--skip-generate"], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});
execFileSync(tsx, ["prisma/init-fts.ts"], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});
execFileSync(tsx, ["scripts/init-db.ts"], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});
execFileSync(tsx, ["tests/e2e/seed.ts"], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});
