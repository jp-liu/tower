import { PrismaClient } from "@prisma/client";
import { getDatabaseDir, getTowerDbFilePath } from "./tower-dir";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Derive the SQLite URL from the resolved data dir (getTowerDir) rather than
// trusting the DATABASE_URL env var. The DB location and the asset storage root
// (getStorageDir) then always hang off the SAME root — they can never disagree.
// The dev/prod asset leak was exactly such a disagreement (DB pinned to prod via
// DATABASE_URL, storage drifting to dev via a leaked TOWER_DATA_DIR).
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: `file:${getTowerDbFilePath()}`,
    log: [],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

let initialized = false;

export async function initDb(): Promise<PrismaClient> {
  if (initialized) return db;
  getDatabaseDir(); // ensure ~/.tower/database exists before the first connect
  await db.$connect();
  await db.$queryRaw`PRAGMA journal_mode=WAL`;
  await db.$queryRaw`PRAGMA busy_timeout=5000`;
  initialized = true;
  return db;
}

/**
 * Reset the database connection after a DB file swap (restore/reset).
 * Disconnects, resets the initialized flag, and re-runs PRAGMAs.
 */
export async function resetDbConnection(): Promise<void> {
  try { await db.$disconnect(); } catch { /* best-effort */ }
  initialized = false;
  await initDb();
}

// Ensure WAL is flushed and connections closed on exit
process.on("SIGTERM", () => { db.$disconnect().catch(() => {}); });
process.on("SIGINT", () => { db.$disconnect().catch(() => {}); });
