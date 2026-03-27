import { PrismaClient, Prisma } from "@prisma/client";

// Separate PrismaClient for the MCP stdio process (not shared with Next.js app)
export const db = new PrismaClient();

export async function initDb(): Promise<PrismaClient> {
  await db.$connect();
  await db.$queryRaw(Prisma.sql`PRAGMA journal_mode=WAL`);
  await db.$queryRaw(Prisma.sql`PRAGMA busy_timeout=5000`);
  return db;
}
