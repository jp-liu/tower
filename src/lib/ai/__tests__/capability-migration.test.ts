import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { up as migrateApiConnections } from "../../../../scripts/migrations/0009-api-connections";
import { up as migrateCapabilities } from "../../../../scripts/migrations/0010-capability-targets";

const clients: PrismaClient[] = [];
const directories: string[] = [];

async function database() {
  const directory = await mkdtemp(path.join(tmpdir(), "tower-capability-migration-"));
  directories.push(directory);
  const client = new PrismaClient({ datasourceUrl: `file:${path.join(directory, "tower.db")}` });
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("0010 capability target migration", () => {
  it("freezes defaults in an empty database without adding backups", async () => {
    const prisma = await database();
    await migrateApiConnections(prisma);
    await migrateCapabilities(prisma);

    const configs = await prisma.$queryRawUnsafe<Array<{ slot: string; migrationStatus: string }>>(
      `SELECT "slot", "migrationStatus" FROM "AiCapabilityConfig" ORDER BY "slot"`,
    );
    const targets = await prisma.$queryRawUnsafe<Array<{ slot: string; provider: string; order: number }>>(
      `SELECT c."slot", p."provider", t."order" FROM "AiCapabilityTarget" t ` +
        `JOIN "AiCapabilityConfig" c ON c."id" = t."capabilityConfigId" ` +
        `JOIN "ProviderConnection" p ON p."id" = t."connectionId" ORDER BY c."slot"`,
    );
    expect(configs).toHaveLength(5);
    expect(targets).toHaveLength(5);
    expect(targets.every((target) => target.provider === "claude" && target.order === 0)).toBe(true);
    expect(configs.every((config) => config.migrationStatus === "defaulted")).toBe(true);
  });

  it("maps legacy CLI, leaves legacy API unmapped, and is idempotent", async () => {
    const prisma = await database();
    await migrateApiConnections(prisma);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "AiCapabilityConfig" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "slot" TEXT NOT NULL,
        "provider" TEXT NOT NULL DEFAULT 'claude',
        "mode" TEXT NOT NULL DEFAULT 'cli',
        "model" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "AiCapabilityConfig_slot_key" ON "AiCapabilityConfig"("slot")`,
    );
    const now = new Date().toISOString();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AiCapabilityConfig" ("id", "slot", "provider", "mode", "model", "updatedAt") ` +
        `VALUES ('terminal-config', 'terminal', 'codex', 'cli', 'future-cli-model', ?)`,
      now,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AiCapabilityConfig" ("id", "slot", "provider", "mode", "model", "updatedAt") ` +
        `VALUES ('summary-config', 'summary', 'openai', 'api', 'gpt-future', ?)`,
      now,
    );

    await migrateCapabilities(prisma);
    const firstTargets = await prisma.$queryRawUnsafe<Array<{
      id: string;
      slot: string;
      connectionKey: string;
      modelId: string | null;
      order: number;
    }>>(
      `SELECT t."id", c."slot", p."connectionKey", t."modelId", t."order" ` +
        `FROM "AiCapabilityTarget" t ` +
        `JOIN "AiCapabilityConfig" c ON c."id" = t."capabilityConfigId" ` +
        `JOIN "ProviderConnection" p ON p."id" = t."connectionId" ORDER BY c."slot"`,
    );
    const statuses = await prisma.$queryRawUnsafe<Array<{ slot: string; migrationStatus: string }>>(
      `SELECT "slot", "migrationStatus" FROM "AiCapabilityConfig" ORDER BY "slot"`,
    );
    expect(firstTargets.find((target) => target.slot === "terminal")).toMatchObject({
      connectionKey: "cli:codex",
      modelId: "future-cli-model",
      order: 0,
    });
    expect(firstTargets.some((target) => target.slot === "summary")).toBe(false);
    expect(statuses.find((config) => config.slot === "summary")?.migrationStatus)
      .toBe("legacy_api_unmapped");

    await migrateCapabilities(prisma);
    const secondTargets = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "AiCapabilityTarget" ORDER BY "id"`,
    );
    expect(secondTargets.map((target) => target.id).sort())
      .toEqual(firstTargets.map((target) => target.id).sort());
  });

  it("prefers a connected Claude CLI when freezing missing-slot defaults", async () => {
    const prisma = await database();
    await migrateApiConnections(prisma);
    const now = new Date().toISOString();
    for (const provider of ["codex", "claude"]) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ProviderConnection" (` +
          `"id", "connectionKey", "name", "kind", "provider", "enabled", "testStatus", "testOk", "updatedAt"` +
          `) VALUES (?, ?, ?, 'cli', ?, true, 'connected', true, ?)`,
        `${provider}-connection`,
        `cli:${provider}`,
        provider,
        provider,
        now,
      );
    }
    await migrateCapabilities(prisma);
    const targets = await prisma.$queryRawUnsafe<Array<{ provider: string }>>(
      `SELECT p."provider" FROM "AiCapabilityTarget" t ` +
        `JOIN "ProviderConnection" p ON p."id" = t."connectionId"`,
    );
    expect(targets).toHaveLength(5);
    expect(targets.every((target) => target.provider === "claude")).toBe(true);
  });
});
