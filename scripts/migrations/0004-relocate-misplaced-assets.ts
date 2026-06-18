/**
 * Relocate ProjectAsset files that an old create_task bug wrote OUTSIDE the
 * Tower storage root, and rewrite the absolute path stored on each row.
 *
 * Why: create_task used to build the asset dir from the install/cwd location
 * instead of the storage root:
 *     join(resolve(__dirname, "../../.."), "data", "assets", projectId, file)
 * so attachments landed under e.g.
 *     ~/project/data/assets/<projectId>/...            (a local checkout)
 *     /usr/local/lib/.../data/assets/<projectId>/...   (global npm install — often unwritable)
 *     C:\...\node_modules\...\data\assets\...           (Windows global install)
 * instead of the correct <storage>/assets/<projectId>/... (storage = ~/.tower/
 * storage, or a custom Settings location).
 *
 * What: for every ProjectAsset whose path carries the bug signature
 * (…/data/assets/…), move the on-disk file (if present on THIS machine) into the
 * canonical assets dir and update the row. Runs once per DB via the
 * AppliedMigration ledger (dev and prod each carry their own).
 *
 * Safety:
 *  - Detection is restricted to the `data/assets` signature. The correct layout
 *    is `storage/assets` and never contains `data/assets`, so rows that merely
 *    live under a DIFFERENT but legitimate storage root (e.g. a dev DB that
 *    references the prod ~/.tower path) are LEFT UNTOUCHED — moving them could
 *    break the environment that owns the file.
 *  - copyFileSync is cross-volume safe; we copy first, update the DB, then drop
 *    the source, so a crash mid-move never loses the file.
 *  - Idempotent: once a file is under the storage root the row is skipped, so a
 *    re-run (e.g. if the ledger were lost) is a no-op.
 *  - Per-file failures (permissions, locks) are logged and skipped — one bad
 *    file neither blocks startup nor prevents this migration from being recorded.
 *
 * Storage-root resolution is INLINED on purpose: a migration is a point-in-time
 * snapshot, and the published npm package contains scripts/ but NOT src/, so it
 * cannot import src/lib/tower-dir. The logic mirrors getStorageDir() as of this
 * migration: TOWER_STORAGE_DIR env → storage-location pointer file → default
 * <data-dir>/storage, where data-dir is TOWER_DATA_DIR or ~/.tower.
 */

import { PrismaClient } from "@prisma/client";
import {
  existsSync,
  statSync,
  copyFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
} from "fs";
import { basename, extname, join, resolve, sep } from "path";
import { homedir } from "os";

function getTowerDir(): string {
  return process.env.TOWER_DATA_DIR || join(homedir(), ".tower");
}

function readStoragePointer(): string | null {
  try {
    const p = readFileSync(join(getTowerDir(), "storage-location"), "utf-8").trim();
    return p.length > 0 ? p : null;
  } catch {
    return null;
  }
}

function getStorageDir(): string {
  const override = process.env.TOWER_STORAGE_DIR || readStoragePointer();
  return override && override.length > 0 ? override : join(getTowerDir(), "storage");
}

/** True when `p` already lives under the canonical assets root. Exported for tests. */
export function isUnderRoot(p: string, root: string): boolean {
  const rp = resolve(p);
  const rr = resolve(root);
  return rp === rr || rp.startsWith(rr + sep);
}

/**
 * The bug always built paths as join(X, "data", "assets", …), so every victim
 * contains a `/data/assets/` segment. The correct layout (`storage/assets`)
 * never does. Match ONLY this signature to avoid touching legitimately
 * relocated files under another storage root. Exported for tests.
 */
export function hasBugSignature(p: string): boolean {
  return /(^|\/)data\/assets\//.test(p.replace(/\\/g, "/"));
}

/** A non-colliding destination inside `dir`, reusing an identical existing file. */
function uniqueDest(dir: string, filename: string, srcSize: number): string {
  let candidate = join(dir, filename);
  if (!existsSync(candidate)) return candidate;
  try {
    if (statSync(candidate).size === srcSize) return candidate; // same file already
  } catch {
    /* fall through to renaming */
  }
  const ext = extname(filename);
  const base = basename(filename, ext);
  let counter = 1;
  do {
    candidate = join(dir, `${base} (${counter})${ext}`);
    counter++;
  } while (existsSync(candidate));
  return candidate;
}

export async function up(prisma: PrismaClient): Promise<void> {
  const assetsRoot = join(getStorageDir(), "assets");

  const assets: { id: string; projectId: string; filename: string; path: string }[] =
    await prisma.projectAsset.findMany({
      select: { id: true, projectId: true, filename: true, path: true },
    });

  let moved = 0;
  let dbFixed = 0; // file already at target, only the stale DB path was rewritten
  let missing = 0; // bug-victim file absent on this machine — cannot migrate
  let otherLocation = 0; // outside root but NOT the bug signature — left untouched
  let failed = 0;

  for (const a of assets) {
    if (isUnderRoot(a.path, assetsRoot)) continue; // already correct
    if (!hasBugSignature(a.path)) {
      otherLocation++;
      continue;
    }

    const targetDir = join(assetsRoot, a.projectId);
    const fileName = basename(a.path) || a.filename;
    const srcExists = existsSync(a.path);
    const presumedTarget = join(targetDir, fileName);
    const targetAlreadyThere = !srcExists && existsSync(presumedTarget);

    if (!srcExists && !targetAlreadyThere) {
      missing++;
      continue;
    }

    try {
      if (targetAlreadyThere) {
        await prisma.projectAsset.update({ where: { id: a.id }, data: { path: presumedTarget } });
        dbFixed++;
        continue;
      }

      const srcSize = statSync(a.path).size;
      const dest = uniqueDest(targetDir, fileName, srcSize);
      mkdirSync(targetDir, { recursive: true });
      const sameAlready = existsSync(dest) && statSync(dest).size === srcSize;
      if (!sameAlready) copyFileSync(a.path, dest);
      await prisma.projectAsset.update({ where: { id: a.id }, data: { path: dest } });
      try {
        rmSync(a.path, { force: true });
      } catch {
        /* old file left behind — harmless; the DB already points at the new copy */
      }
      moved++;
    } catch (err) {
      failed++;
      console.warn(
        `  failed to relocate ${a.path}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (moved || dbFixed || missing || failed) {
    console.log(
      `  relocated assets — moved ${moved}, db-path-fixed ${dbFixed}, ` +
        `missing-source ${missing}, failed ${failed}` +
        (otherLocation ? `, other-location-left ${otherLocation}` : "")
    );
  }
}
