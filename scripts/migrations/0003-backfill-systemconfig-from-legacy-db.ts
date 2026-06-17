/**
 * Backfill SystemConfig keys from a legacy project-local prisma/dev.db into the
 * current database.
 *
 * Why: Tower used to keep all data in `<project>/prisma/dev.db`. When the data
 * directory moved to ~/.tower (prod) / ~/.tower-dev (dev), the SystemConfig
 * table — which holds user settings like git.pathMappingRules, CLI profiles and
 * onboarding flags — was NOT carried over. The new DB simply started without
 * those keys. Symptom: Settings → "Git 路径映射规则" silently empty even though
 * the user had configured them; project creation kept working only because
 * resolveGitLocalPath falls back to a hardcoded convention, masking the loss.
 *
 * What: copy every SystemConfig key from the legacy DB that is MISSING in the
 * current DB. Additive only — never overwrites a key that already exists here.
 * Generic over all keys (not just git rules) since the same gap affects every
 * setting persisted in SystemConfig.
 *
 * Safety:
 *  - No-op when no legacy DB exists (fresh installs, and the published npm
 *    package — src/ and prisma/dev.db are absent there).
 *  - No-op when the legacy DB IS the current DB (some dev setups point
 *    DATABASE_URL at prisma/dev.db).
 *  - Only touches SystemConfig → FTS-safe (no notes_fts triggers involved).
 *  - Legacy DB read errors are caught and treated as "nothing to migrate", so a
 *    corrupt/locked legacy file never blocks startup or later migrations.
 *  - Idempotent: recorded in AppliedMigration after first success; the additive
 *    check also makes a re-run a no-op even if the ledger were lost.
 *
 * Paths and table/column references are hardcoded on purpose — a migration is a
 * point-in-time snapshot and must keep doing exactly what it did the day it
 * shipped (src/ is also absent from the published package).
 */

import { PrismaClient } from "@prisma/client";
import { existsSync, realpathSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Default to the conventional project-local DB; allow an explicit override for
// non-standard layouts (and to exercise this migration in tests).
const LEGACY_DB_PATH = process.env.TOWER_LEGACY_DB
  ? resolve(process.env.TOWER_LEGACY_DB)
  : join(PROJECT_ROOT, "prisma", "dev.db");

/**
 * Pure merge step: legacy rows whose key is absent from the current DB.
 * Exported for unit testing. Additive only — keys already present are kept.
 */
export function selectMissingConfig<T extends { key: string }>(
  legacyRows: T[],
  currentKeys: Set<string>
): T[] {
  return legacyRows.filter((row) => !currentKeys.has(row.key));
}

/** Absolute path of the DB the runner is migrating (current DATABASE_URL). */
function currentDbFile(): string | null {
  const match = (process.env.DATABASE_URL ?? "").match(/^file:(.+)$/);
  return match ? resolve(PROJECT_ROOT, match[1]) : null;
}

function isSamePath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a) === resolve(b);
  }
}

export async function up(prisma: PrismaClient): Promise<void> {
  if (!existsSync(LEGACY_DB_PATH)) return;

  const current = currentDbFile();
  if (current && isSamePath(current, LEGACY_DB_PATH)) return;

  const legacy = new PrismaClient({
    datasources: { db: { url: `file:${LEGACY_DB_PATH}` } },
  });
  let legacyRows: { key: string; value: string }[];
  try {
    legacyRows = await legacy.systemConfig.findMany({
      select: { key: true, value: true },
    });
  } catch (err) {
    // Unreadable / old-schema / locked legacy DB → treat as nothing to migrate.
    // Non-fatal: do not block startup or later migrations.
    console.warn(
      `  legacy DB unreadable, skipping SystemConfig backfill: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return;
  } finally {
    await legacy.$disconnect();
  }
  if (legacyRows.length === 0) return;

  const currentKeys = new Set(
    (await prisma.systemConfig.findMany({ select: { key: true } })).map((r) => r.key)
  );
  const missing = selectMissingConfig(legacyRows, currentKeys);
  if (missing.length === 0) return;

  for (const row of missing) {
    await prisma.systemConfig.create({ data: { key: row.key, value: row.value } });
  }
  console.log(
    `  backfilled ${missing.length} systemConfig key(s) from legacy prisma/dev.db: ${missing
      .map((m) => m.key)
      .join(", ")}`
  );
}
