import { PrismaClient } from "@prisma/client";

export const db = new PrismaClient();

export async function initDb(): Promise<PrismaClient> {
  await db.$connect();
  await db.$queryRawUnsafe("PRAGMA journal_mode=WAL");
  return db;
}
