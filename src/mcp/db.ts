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
  await db.$queryRaw(Prisma.sql`PRAGMA journal_mode=WAL`);
  await db.$queryRaw(Prisma.sql`PRAGMA busy_timeout=5000`);
  return db;
}
