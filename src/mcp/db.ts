import { PrismaClient, Prisma } from "@prisma/client";
import { getDatabaseDir, getTowerDbFilePath } from "@/lib/tower-dir";

// Separate PrismaClient for the MCP stdio process (not shared with Next.js app).
// URL is derived from the resolved data dir — env-guard (imported first in
// index.ts) has already pinned TOWER_DATA_DIR before this runs, so the DB and the
// asset storage root always share one root and can never disagree.
export const db = new PrismaClient({ datasourceUrl: `file:${getTowerDbFilePath()}` });

export async function initDb(): Promise<PrismaClient> {
  getDatabaseDir(); // ensure ~/.tower/database exists before the first connect
  await db.$connect();
  // busy_timeout FIRST: `journal_mode=WAL` needs a brief write lock, and with a
  // default 0 timeout it fails instantly with SQLITE_BUSY under contention —
  // which in the MCP entrypoint throws → process.exit(1) → the server never
  // finishes its stdio handshake and sits at `pending` for that turn. Setting
  // the 5s timeout first makes the WAL pragma wait for the lock instead.
  await db.$queryRaw(Prisma.sql`PRAGMA busy_timeout=5000`);
  await db.$queryRaw(Prisma.sql`PRAGMA journal_mode=WAL`);
  return db;
}
