import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query"] : [],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

let initialized = false;

export async function initDb(): Promise<PrismaClient> {
  if (initialized) return db;
  await db.$connect();
  await db.$queryRaw`PRAGMA journal_mode=WAL`;
  await db.$queryRaw`PRAGMA busy_timeout=5000`;
  initialized = true;
  return db;
}

// Ensure WAL is flushed and connections closed on exit
process.on("SIGTERM", () => { db.$disconnect().catch(() => {}); });
process.on("SIGINT", () => { db.$disconnect().catch(() => {}); });
