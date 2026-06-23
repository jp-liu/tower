/**
 * MUST be imported FIRST in the MCP entrypoint — before `@prisma/client`.
 *
 * The MCP stdio process is spawned by a CLI (claude / codex / feishu bot) from
 * the Tower source tree and does NOT inherit Tower's runtime env. Importing
 * `@prisma/client` auto-loads the repo's `.env` via dotenv, and this repo's
 * `.env` carries a dev override (`TOWER_DATA_DIR=~/.tower-dev`).
 *
 * dotenv never overrides an already-set variable, so `DATABASE_URL` (pinned in
 * the MCP registration → prod `~/.tower`) survives, but `TOWER_DATA_DIR` — which
 * older / hand-written registrations don't pin — gets injected as the dev path.
 * The result: `create_task` writes the task row to the prod DB (via the pinned
 * DATABASE_URL) while `getStorageDir()` lands its assets in
 * `~/.tower-dev/storage`. Same class of leak as bin/tower.mjs guards against on
 * the Next.js side.
 *
 * Fix: pin TOWER_DATA_DIR here, before dotenv can run, so the dev override can't
 * leak in. Derive it from DATABASE_URL when present so the data dir always
 * agrees with the DB the registration chose (dev stays dev, prod stays prod);
 * otherwise fall back to the canonical ~/.tower.
 */
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/**
 * Resolve the data dir the MCP process should pin, given the already-set env.
 * Pure (no process.env access) so it can be unit-tested.
 *
 * - `TOWER_DATA_DIR` already set (registration pinned it) → respect it.
 * - else derive from a `file:` `DATABASE_URL` (`<dir>/database/tower.db` → `<dir>`).
 * - else fall back to `~/.tower`.
 */
export function resolveTowerDataDir(env: {
  TOWER_DATA_DIR?: string;
  DATABASE_URL?: string;
}): string {
  if (env.TOWER_DATA_DIR) return env.TOWER_DATA_DIR;
  const dbUrl = env.DATABASE_URL;
  if (dbUrl && dbUrl.startsWith("file:")) {
    // file:/abs/.tower/database/tower.db → data dir = /abs/.tower
    const dbPath = dbUrl.slice("file:".length);
    return dirname(dirname(dbPath));
  }
  return join(homedir(), ".tower");
}

// Side effect: pin TOWER_DATA_DIR before any dotenv-loading import runs.
process.env.TOWER_DATA_DIR = resolveTowerDataDir({
  TOWER_DATA_DIR: process.env.TOWER_DATA_DIR,
  DATABASE_URL: process.env.DATABASE_URL,
});
