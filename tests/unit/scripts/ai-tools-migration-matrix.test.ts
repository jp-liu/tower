// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { up as migrateApiConnections } from "../../../scripts/migrations/0009-api-connections";
import { up as migrateCapabilityTargets } from "../../../scripts/migrations/0010-capability-targets";

const root = path.resolve(import.meta.dirname, "../../..");
const prismaBin = path.join(root, "node_modules", ".bin", "prisma");
const tsxBin = path.join(root, "node_modules", ".bin", "tsx");
const currentSchema = path.join(root, "prisma", "schema.prisma");
const migrationDir = path.join(root, "scripts", "migrations");
const tempDirs: string[] = [];

function migrationIds(): string[] {
  return readdirSync(migrationDir)
    .filter((file) => /^\d.*\.(?:ts|mjs|js)$/.test(file))
    .map((file) => file.replace(/\.(?:ts|mjs|js)$/, ""))
    .sort();
}

function envFor(database: string, dataDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: `file:${database}`,
    TOWER_DATA_DIR: dataDir,
  };
}

function pushSchema(schema: string, database: string, dataDir: string, acceptDataLoss = false): void {
  execFileSync(prismaBin, [
    "db", "push", "--schema", schema, "--skip-generate",
    ...(acceptDataLoss ? ["--accept-data-loss"] : []),
  ], {
    cwd: root,
    env: envFor(database, dataDir),
    stdio: "pipe",
  });
}

function runMigrations(database: string, dataDir: string): string {
  return execFileSync(tsxBin, ["scripts/run-migrations.ts"], {
    cwd: root,
    env: envFor(database, dataDir),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function fixture(name: string): Promise<{ dir: string; database: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), `tower-ai-migration-${name}-`));
  tempDirs.push(dir);
  return { dir, database: path.join(dir, "tower.db") };
}

async function seedCore(prisma: PrismaClient): Promise<void> {
  const now = new Date().toISOString();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Workspace" ("id", "name", "updatedAt") VALUES ('w1', 'Legacy workspace', ?)`,
    now,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Project" ("id", "name", "workspaceId", "updatedAt") VALUES ('p1', 'Legacy project', 'w1', ?)`,
    now,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Task" ("id", "title", "projectId", "updatedAt") VALUES ('t1', 'Legacy task', 'p1', ?)`,
    now,
  );
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AI Tools 0.3 migration matrix", () => {
  it("upgrades a fresh current-schema database and repeats every migration safely", async () => {
    const { dir, database } = await fixture("fresh");
    pushSchema(currentSchema, database, dir);

    const first = runMigrations(database, dir);
    const second = runMigrations(database, dir);
    expect(first).not.toContain("FAILED");
    expect(second).not.toContain("applying");

    const prisma = new PrismaClient({ datasourceUrl: `file:${database}` });
    try {
      const ids = migrationIds();
      const ledger = await prisma.appliedMigration.findMany({ orderBy: { id: "asc" } });
      expect(ledger.map((entry) => entry.id)).toEqual(ids);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual([...ids].sort());
      expect(ids.map((id) => Number(id.slice(0, 4))))
        .toEqual(Array.from({ length: ids.length }, (_, index) => index + 1));

      const slots = await prisma.aiCapabilityConfig.findMany({
        include: { targets: true },
        orderBy: { slot: "asc" },
      });
      expect(slots).toHaveLength(5);
      expect(slots.every((slot) => slot.targets.length === 1)).toBe(true);
      const foreignKeys = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`PRAGMA foreign_key_check`);
      expect(foreignKeys).toEqual([]);
      const indexes = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT "name" FROM "sqlite_master" WHERE "type" = 'index'`,
      );
      expect(indexes.map((index) => index.name)).toEqual(expect.arrayContaining([
        "ApiConnectionKey_connectionId_enabled_testStatus_idx",
        "AiCapabilityTarget_capabilityConfigId_order_key",
        "AssistantSession_legacySource_legacyId_key",
        "AssistantMessage_sessionId_sequence_key",
      ]));
    } finally {
      await prisma.$disconnect();
    }
  }, 60_000);

  it("upgrades the real v0.2.60 schema without losing legacy execution/config/session data", async () => {
    const { dir, database } = await fixture("legacy");
    const oldSchemaPath = path.join(dir, "schema-0.2.60.prisma");
    const oldSchema = execFileSync("git", ["show", "v0.2.60:prisma/schema.prisma"], {
      cwd: root,
      encoding: "utf8",
    });
    await writeFile(oldSchemaPath, oldSchema, "utf8");
    pushSchema(oldSchemaPath, database, dir);

    const prisma = new PrismaClient({ datasourceUrl: `file:${database}` });
    try {
      await seedCore(prisma);
      const now = new Date().toISOString();
      await prisma.$executeRawUnsafe(
        `INSERT INTO "CliProfile" ("id", "name", "command", "baseArgs", "envVars", "isDefault", "updatedAt") ` +
          `VALUES ('cli1', 'Legacy Claude', 'claude', '["--legacy"]', '{"LEGACY":"yes"}', true, ?)`,
        now,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AgentConfig" ("id", "agent", "configName", "appendPrompt", "settings", "isDefault", "updatedAt") ` +
          `VALUES ('agent1', 'CLAUDE_CODE', 'legacy', 'keep-prompt', '{"model":"old-sonnet"}', true, ?)`,
        now,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "SystemConfig" ("id", "key", "value", "updatedAt") VALUES ('cfg1', 'assistant.model', 'old-sonnet', ?)`,
        now,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ProviderConnection" ("id", "provider", "testOk", "updatedAt") VALUES ('legacy-claude', 'claude', true, ?)`,
        now,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AiCapabilityConfig" ("id", "slot", "provider", "mode", "model", "updatedAt") ` +
          `VALUES ('terminal-config', 'terminal', 'claude', 'cli', 'legacy-model', ?)`,
        now,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "TaskExecution" ("id", "taskId", "agent", "status", "sessionId") ` +
          `VALUES ('exec1', 't1', 'CLAUDE_CODE', 'COMPLETED', 'legacy-claude-session')`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "TaskMessage" ("id", "role", "content", "taskId", "executionId", "metadata") ` +
          `VALUES ('msg1', 'ASSISTANT', 'legacy answer', 't1', 'exec1', '{"sessionId":"legacy-claude-session"}')`,
      );
    } finally {
      await prisma.$disconnect();
    }

    pushSchema(currentSchema, database, dir, true);
    expect(runMigrations(database, dir)).not.toContain("FAILED");
    expect(runMigrations(database, dir)).not.toContain("applying");

    const upgraded = new PrismaClient({ datasourceUrl: `file:${database}` });
    try {
      const [profile] = await upgraded.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM "CliProfile" WHERE "id" = 'cli1'`,
      );
      const [agent] = await upgraded.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM "AgentConfig" WHERE "id" = 'agent1'`,
      );
      const [execution] = await upgraded.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM "TaskExecution" WHERE "id" = 'exec1'`,
      );
      const [message] = await upgraded.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM "TaskMessage" WHERE "id" = 'msg1'`,
      );
      const [config] = await upgraded.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM "SystemConfig" WHERE "id" = 'cfg1'`,
      );
      const [connection] = await upgraded.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM "ProviderConnection" WHERE "id" = 'legacy-claude'`,
      );
      expect(profile).toMatchObject({ command: "claude", baseArgs: '["--legacy"]', envVars: '{"LEGACY":"yes"}' });
      expect(agent).toMatchObject({ appendPrompt: "keep-prompt", settings: '{"model":"old-sonnet"}' });
      expect(execution).toMatchObject({ sessionId: "legacy-claude-session", connectionId: "legacy-claude" });
      expect(message).toMatchObject({ metadata: '{"sessionId":"legacy-claude-session"}' });
      expect(config).toMatchObject({ key: "assistant.model", value: "old-sonnet" });
      expect(connection).toMatchObject({ connectionKey: "cli:claude", provider: "claude" });
      const foreignKeys = await upgraded.$queryRawUnsafe<Array<Record<string, unknown>>>(`PRAGMA foreign_key_check`);
      expect(foreignKeys).toEqual([]);
    } finally {
      await upgraded.$disconnect();
    }
  }, 60_000);

  it("resumes a database whose 0.3 ledger stops at 0010 and preserves every new data family", async () => {
    const { dir, database } = await fixture("partial");
    pushSchema(currentSchema, database, dir);
    const prisma = new PrismaClient({ datasourceUrl: `file:${database}` });
    try {
      await migrateApiConnections(prisma);
      await migrateCapabilityTargets(prisma);
      const ids = migrationIds();
      for (const id of ids.filter((entry) => Number(entry.slice(0, 4)) <= 10)) {
        await prisma.appliedMigration.create({ data: { id } });
      }
      await seedCore(prisma);
      const now = new Date().toISOString();
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ProviderConnection" (` +
          `"id", "connectionKey", "name", "kind", "provider", "enabled", "testStatus", "testOk", ` +
          `"baseUrl", "defaultModelId", "settingsJson", "updatedAt"` +
          `) VALUES ('api1', NULL, 'Fake API', 'api', 'openai-compatible', true, 'connected', true, ` +
          `'http://127.0.0.1:9/custom', 'fake-model', '{}', ?), ` +
          `('plugin1', 'cli:@fixture/provider', 'Fixture CLI', 'cli', '@fixture/provider', true, 'connected', true, ` +
          `NULL, 'fixture-model', '{"allowed":true}', ?)`,
        now,
        now,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ApiConnectionKey" ("id", "connectionId", "label", "value", "enabled", "order", "testStatus", "updatedAt") ` +
          `VALUES ('key1', 'api1', 'primary', 'stored-secret', true, 0, 'ok', ?)`,
        now,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ApiConnectionModel" ("id", "connectionId", "modelId", "source", "available", "updatedAt") ` +
          `VALUES ('model1', 'api1', 'fake-model', 'manual', true, ?)`,
        now,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "TaskExecution" ("id", "taskId", "agent", "status", "connectionId", "modelId", "targetId") ` +
          `VALUES ('exec-partial', 't1', 'CLI_PLUGIN', 'COMPLETED', 'plugin1', 'fixture-model', 'target-snapshot')`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AssistantSession" ("id", "title", "legacySource", "legacyId", "updatedAt") ` +
          `VALUES ('session1', 'Provider-neutral', 'claude', 'legacy-1', ?)`,
        now,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AssistantMessage" ("id", "sessionId", "sequence", "role", "partsJson", "updatedAt") ` +
          `VALUES ('assistant-message1', 'session1', 0, 'ASSISTANT', '[{"type":"text","text":"kept"}]', ?)`,
        now,
      );
    } finally {
      await prisma.$disconnect();
    }

    expect(runMigrations(database, dir)).not.toContain("FAILED");
    expect(runMigrations(database, dir)).not.toContain("applying");
    const upgraded = new PrismaClient({ datasourceUrl: `file:${database}` });
    try {
      expect((await upgraded.appliedMigration.findMany()).map((row) => row.id).sort()).toEqual(migrationIds());
      expect(await upgraded.apiConnectionKey.findUnique({ where: { id: "key1" } }))
        .toMatchObject({ value: "stored-secret", testStatus: "ok" });
      expect(await upgraded.apiConnectionModel.findUnique({ where: { id: "model1" } }))
        .toMatchObject({ modelId: "fake-model", source: "manual" });
      expect(await upgraded.providerConnection.findUnique({ where: { id: "plugin1" } }))
        .toMatchObject({ settingsJson: '{"allowed":true}' });
      expect(await upgraded.taskExecution.findUnique({ where: { id: "exec-partial" } }))
        .toMatchObject({ connectionId: "plugin1", modelId: "fixture-model", targetId: "target-snapshot" });
      expect(await upgraded.assistantSession.findUnique({ where: { id: "session1" } }))
        .toMatchObject({ legacySource: "claude", legacyId: "legacy-1" });
      expect(await upgraded.assistantMessage.findUnique({ where: { id: "assistant-message1" } }))
        .toMatchObject({ partsJson: '[{"type":"text","text":"kept"}]' });
      const foreignKeys = await upgraded.$queryRawUnsafe<Array<Record<string, unknown>>>(`PRAGMA foreign_key_check`);
      expect(foreignKeys).toEqual([]);
    } finally {
      await upgraded.$disconnect();
    }
  }, 60_000);
});
