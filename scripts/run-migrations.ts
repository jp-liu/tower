/**
 * One-shot data migration runner (pre-start lifecycle phase).
 *
 * Runs every file in scripts/migrations/ that hasn't been applied to THIS
 * database yet, in filename order, exactly once. Applied ids are recorded in
 * the `AppliedMigration` table (DB-bound ledger — see schema.prisma), so the
 * record can never drift from the data it describes (dev DB and prod DB each
 * carry their own ledger).
 *
 * Each migration file exports `up(prisma)`:
 *   export async function up(prisma) { ... }   // must be idempotent
 *
 * Failure policy: a failing migration is logged and retried on the next start;
 * later migrations are NOT run (they may depend on it), and startup is blocked.
 * Starting recovery workers against partially migrated delivery state can replay
 * messages that the platform already accepted.
 *
 * Invoked by bin/tower.mjs pre-start, and available in dev via `pnpm db:migrate`.
 * Requires the schema to be current (the AppliedMigration table must exist) —
 * bin/tower.mjs guarantees this by running schema sync first.
 */

import { PrismaClient } from "@prisma/client";
import { existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

async function main() {
  if (!existsSync(MIGRATIONS_DIR)) return;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d.*\.(ts|mjs|js)$/.test(f))
    .sort();
  if (files.length === 0) return;

  const prisma = new PrismaClient();
  try {
    // Ensure the ledger table exists before reading it. In prod bin/tower.mjs
    // syncs the schema first, but dev never ran a schema sync that included this
    // table — and DBs created before AppliedMigration was added simply lack it.
    // Create it additively via raw SQL (idempotent, FTS-safe — never touches the
    // notes_fts virtual tables that make `prisma db push` hang). No-op when the
    // table already exists, so prod behaviour is unchanged.
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "AppliedMigration" (` +
        `"id" TEXT NOT NULL PRIMARY KEY, ` +
        `"appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`
    );

    const appliedRows = await prisma.appliedMigration.findMany({ select: { id: true } });
    const applied = new Set(appliedRows.map((r) => r.id));

    let failure: unknown;
    for (const file of files) {
      const id = file.replace(/\.(ts|mjs|js)$/, "");
      if (applied.has(id)) continue;

      try {
        const mod = await import(pathToFileURL(join(MIGRATIONS_DIR, file)).href);
        const up = mod.up ?? mod.default;
        if (typeof up !== "function") {
          console.error(`[migrate] ${id}: no up()/default export — skipping`);
          continue;
        }
        console.log(`[migrate] applying ${id}...`);
        await up(prisma);
        await prisma.appliedMigration.create({ data: { id } });
        console.log(`[migrate] ${id} done`);
      } catch (err) {
        // Stop here — later migrations may depend on this one. Not recorded, so
        // it retries on next start. The non-zero exit blocks server startup.
        console.error(`[migrate] ${id} FAILED (will retry next start):`, err);
        failure = err;
        break;
      }
    }
    if (failure) throw failure;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[migrate] runner failed:", err);
  process.exit(1);
});
