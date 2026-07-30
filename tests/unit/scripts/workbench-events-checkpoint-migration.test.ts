import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { up } from "../../../scripts/migrations/0016-workbench-events-checkpoint";

const tempDirs: string[] = [];

async function database(): Promise<PrismaClient> {
  const dir = await mkdtemp(join(tmpdir(), "tower-workbench-checkpoint-"));
  tempDirs.push(dir);
  const prisma = new PrismaClient({ datasourceUrl: `file:${join(dir, "migration.db")}` });
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "SystemConfig" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "key" TEXT NOT NULL UNIQUE,
      "value" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "AppliedMigration" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  return prisma;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("0016 Workbench event checkpoint migration", () => {
  it("uses the original 0014 application time and preserves it on retries", async () => {
    const prisma = await database();
    try {
      const enabledAt = "2026-07-27T01:02:03.000Z";
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AppliedMigration" ("id", "appliedAt") VALUES (?, ?)`,
        "0014-workbench-events",
        enabledAt,
      );

      await up(prisma);
      await up(prisma);

      const row = await prisma.systemConfig.findUniqueOrThrow({
        where: { key: "workbench.eventsEnabledAt" },
      });
      expect(JSON.parse(row.value)).toBe(enabledAt);
    } finally {
      await prisma.$disconnect();
    }
  });
});
