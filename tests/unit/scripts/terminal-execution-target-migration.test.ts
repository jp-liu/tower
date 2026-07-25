import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { up } from "../../../scripts/migrations/0012-terminal-execution-targets";

const tempDirs: string[] = [];

async function database(): Promise<PrismaClient> {
  const dir = await mkdtemp(join(tmpdir(), "tower-terminal-target-migration-"));
  tempDirs.push(dir);
  return new PrismaClient({ datasourceUrl: `file:${join(dir, "migration.db")}` });
}

async function createLegacyExecutionTable(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "TaskExecution" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "taskId" TEXT NOT NULL,
      "agent" TEXT NOT NULL DEFAULT 'CLAUDE_CODE',
      "status" TEXT NOT NULL DEFAULT 'PENDING'
    )
  `);
}

async function createConnections(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "ProviderConnection" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "connectionKey" TEXT,
      "kind" TEXT NOT NULL DEFAULT 'cli',
      "provider" TEXT NOT NULL
    )
  `);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("0012 Terminal execution target migration", () => {
  it("is a no-op for an empty database", async () => {
    const prisma = await database();
    try {
      await up(prisma);
      await up(prisma);
      const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" = 'TaskExecution'`,
      );
      expect(tables).toEqual([]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("adds nullable snapshots without losing legacy executions", async () => {
    const prisma = await database();
    try {
      await createLegacyExecutionTable(prisma);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "TaskExecution" ("id", "taskId", "agent", "status") VALUES ('e1', 't1', 'CLAUDE_CODE', 'COMPLETED')`,
      );

      await up(prisma);

      const columns = await prisma.$queryRawUnsafe<Array<{ name: string; notnull: bigint }>>(
        `PRAGMA table_info("TaskExecution")`,
      );
      expect(columns
        .filter((column) => ["connectionId", "modelId", "targetId"].includes(column.name))
        .map((column) => ({ name: column.name, notnull: Number(column.notnull) })))
        .toEqual([
          { name: "connectionId", notnull: 0 },
          { name: "modelId", notnull: 0 },
          { name: "targetId", notnull: 0 },
        ]);
      const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM "TaskExecution"`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: "e1", status: "COMPLETED", connectionId: null });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("backfills only a unique exact legacy cli connection and is idempotent", async () => {
    const prisma = await database();
    try {
      await createLegacyExecutionTable(prisma);
      await createConnections(prisma);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "ProviderConnection" ("id", "connectionKey", "kind", "provider") VALUES
          ('claude-cli', 'cli:claude', 'cli', 'claude'),
          ('codex-api', 'api:codex', 'api', 'codex')
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "TaskExecution" ("id", "taskId", "agent") VALUES
          ('claude-exec', 't1', 'CLAUDE_CODE'),
          ('codex-exec', 't2', 'CODEX_CLI'),
          ('plugin-exec', 't3', 'CLI_PLUGIN'),
          ('unknown-exec', 't4', 'FUTURE_CLI')
      `);

      await up(prisma);
      await up(prisma);

      const rows = await prisma.$queryRawUnsafe<Array<{ id: string; connectionId: string | null; modelId: string | null; targetId: string | null }>>(
        `SELECT "id", "connectionId", "modelId", "targetId" FROM "TaskExecution" ORDER BY "id"`,
      );
      expect(rows).toEqual([
        { id: "claude-exec", connectionId: "claude-cli", modelId: null, targetId: null },
        { id: "codex-exec", connectionId: null, modelId: null, targetId: null },
        { id: "plugin-exec", connectionId: null, modelId: null, targetId: null },
        { id: "unknown-exec", connectionId: null, modelId: null, targetId: null },
      ]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("preserves existing 0.3 snapshots", async () => {
    const prisma = await database();
    try {
      await createLegacyExecutionTable(prisma);
      await prisma.$executeRawUnsafe(`ALTER TABLE "TaskExecution" ADD COLUMN "connectionId" TEXT`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "TaskExecution" ADD COLUMN "modelId" TEXT`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "TaskExecution" ADD COLUMN "targetId" TEXT`);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "TaskExecution" ("id", "taskId", "agent", "connectionId", "modelId", "targetId")
        VALUES ('e1', 't1', 'CLAUDE_CODE', 'gone-connection', 'fixed-model', 'historical-target')
      `);

      await up(prisma);

      const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM "TaskExecution"`,
      );
      expect(rows[0]).toMatchObject({
        connectionId: "gone-connection",
        modelId: "fixed-model",
        targetId: "historical-target",
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("leaves legacy rows null when the cli connection mapping is ambiguous", async () => {
    const prisma = await database();
    try {
      await createLegacyExecutionTable(prisma);
      await createConnections(prisma);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "ProviderConnection" ("id", "connectionKey", "kind", "provider") VALUES
          ('claude-a', 'cli:claude', 'cli', 'claude'),
          ('claude-b', 'cli:claude', 'cli', 'claude')
      `);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "TaskExecution" ("id", "taskId", "agent") VALUES ('e1', 't1', 'CLAUDE_CODE')`,
      );

      await up(prisma);

      const rows = await prisma.$queryRawUnsafe<Array<{ connectionId: string | null }>>(
        `SELECT "connectionId" FROM "TaskExecution" WHERE "id" = 'e1'`,
      );
      expect(rows[0]?.connectionId).toBeNull();
    } finally {
      await prisma.$disconnect();
    }
  });
});
