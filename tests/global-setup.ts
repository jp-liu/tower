import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Provision an isolated SQLite database for the test run.
 *
 * Tests must never touch the user's real ~/.tower database. vitest.config.ts
 * pins TOWER_DATA_DIR at a throwaway directory; here we create it and push the
 * Prisma schema into it, so every client derived from that root (the app's `db`
 * singleton and the test-local ones alike) opens a real, empty database.
 *
 * DATABASE_URL is passed to the Prisma CLI only — it reads the schema's
 * `env("DATABASE_URL")` — and is deliberately NOT exported to the test workers.
 * The app derives its DB path from TOWER_DATA_DIR and never reads DATABASE_URL.
 */

function testDataDir(): string {
  const dir = process.env.TOWER_DATA_DIR;
  if (!dir) {
    throw new Error("TOWER_DATA_DIR is not set — vitest.config.ts should pin it");
  }
  // This directory gets wiped below. vitest.config.ts always overrides whatever
  // the ambient shell exports, but a regression there would aim rmSync at the
  // user's real ~/.tower and destroy it — so refuse anything outside the temp
  // root rather than trust the caller.
  const tmpRoot = path.resolve(os.tmpdir());
  if (!path.resolve(dir).startsWith(tmpRoot + path.sep)) {
    throw new Error(
      `Refusing to use TOWER_DATA_DIR=${dir} for tests: not under ${tmpRoot}. ` +
        "Tests must run against a throwaway data root, never a real one."
    );
  }
  return dir;
}

export async function setup() {
  const dataDir = testDataDir();
  // Start from nothing: the pid-keyed directory can survive a crashed run whose
  // teardown never fired, and a recycled pid would then inherit its rows. This
  // is also why `prisma db push` needs no --force-reset (it always sees an empty
  // file) — the flag would be a destructive op on whatever the path points at.
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(path.join(dataDir, "database"), { recursive: true });
  // Prisma 6's SQLite schema engine can fail with an empty "Schema engine
  // error" when the parent directory exists but a nested database file does
  // not. Pre-create the empty file; db push still owns the schema.
  closeSync(openSync(path.join(dataDir, "database", "tower.db"), "a"));

  execFileSync(
    path.join(process.cwd(), "node_modules", ".bin", "prisma"),
    ["db", "push", "--skip-generate"],
    {
      stdio: "pipe",
      env: {
        ...process.env,
        DATABASE_URL: `file:${path.join(dataDir, "database", "tower.db")}`,
      },
    }
  );
}

export async function teardown() {
  rmSync(testDataDir(), { recursive: true, force: true });
}
