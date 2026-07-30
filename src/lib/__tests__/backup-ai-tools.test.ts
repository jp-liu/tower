// @vitest-environment node
import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createApiAdapter, PluginRegistry } from "@tower-org/ai-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { createArchive, extractArchive, swapDirs, type BackupMetadata } from "../backup";

const root = path.resolve(import.meta.dirname, "../../..");
const prismaBin = path.join(root, "node_modules", ".bin", "prisma");
const tempDirs: string[] = [];
const servers: Server[] = [];

function pushSchema(database: string, dataDir: string): void {
  mkdirSync(path.dirname(database), { recursive: true });
  closeSync(openSync(database, "a"));
  execFileSync(prismaBin, ["db", "push", "--schema", path.join(root, "prisma", "schema.prisma"), "--skip-generate"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: `file:${database}`, TOWER_DATA_DIR: dataDir },
    stdio: "pipe",
  });
}

async function listenFakeApi(): Promise<{ baseUrl: string; requests: Array<{ url: string; authorization: string | null }> }> {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url ?? "", authorization: request.headers.authorization ?? null });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: "chatcmpl-restored", object: "chat.completion", created: 1, model: "fixture-model",
      choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake API did not allocate a port");
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AI Tools full backup and restore", () => {
  it("restores keys, targets, plugin registry, Assistant history, and a usable API connection into a second data root", async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), "tower-ai-backup-"));
    tempDirs.push(fixtureRoot);
    const source = path.join(fixtureRoot, "source");
    const restored = path.join(fixtureRoot, "restored");
    const extracted = path.join(fixtureRoot, "extracted");
    const backups = path.join(fixtureRoot, "backups");
    await Promise.all([source, restored, backups].map((dir) => mkdir(dir, { recursive: true })));
    const sourceDatabase = path.join(source, "database", "tower.db");
    await mkdir(path.dirname(sourceDatabase), { recursive: true });
    pushSchema(sourceDatabase, source);
    const fakeApi = await listenFakeApi();

    const sourceDb = new PrismaClient({ datasourceUrl: `file:${sourceDatabase}` });
    try {
      await sourceDb.providerConnection.create({
        data: {
          id: "api-restored", name: "Restored fake API", kind: "api", provider: "openai-compatible",
          enabled: true, testStatus: "connected", testOk: true, baseUrl: fakeApi.baseUrl,
          defaultModelId: "fixture-model",
          apiKeys: { create: { id: "key-restored", label: "primary", value: "CANARY_BACKUP_KEY_71ac", enabled: true, order: 0, testStatus: "ok" } },
          models: { create: { id: "model-restored", modelId: "fixture-model", source: "manual", available: true } },
        },
      });
      for (const slot of ["summary", "dreaming", "analysis", "assistant", "terminal"]) {
        await sourceDb.aiCapabilityConfig.create({
          data: {
            id: `config-${slot}`, slot, migrationStatus: "complete",
            targets: { create: { id: `target-${slot}`, connectionId: "api-restored", modelId: "fixture-model", targetKey: "api-restored:fixture-model", order: 0 } },
          },
        });
      }
      await sourceDb.assistantSession.create({
        data: {
          id: "as_11111111-1111-1111-1111-111111111111", title: "Restored history",
          messages: { create: { id: "am_11111111-1111-1111-1111-111111111111", sequence: 0, role: "ASSISTANT", partsJson: '[{"type":"text","text":"kept"}]' } },
        },
      });
      await sourceDb.$queryRaw`PRAGMA wal_checkpoint(TRUNCATE)`;
    } finally {
      await sourceDb.$disconnect();
    }

    const sourceRegistry = new PluginRegistry({ dataRoot: source });
    await sourceRegistry.initialize();
    const packagePath = path.join(source, "ai", "plugins", "packages", "fixture-1.0.0");
    await mkdir(packagePath, { recursive: true });
    await writeFile(path.join(packagePath, "marker.txt"), "fixture", "utf8");
    await sourceRegistry.set({
      id: "@fixture/provider", version: "1.0.0", integrity: "sha512-fixture", source: "local", installPath: packagePath,
      manifest: { digest: "manifest", entryDigest: "entry", configSchemaDigest: "schema", manifestVersion: 1, apiVersion: "1", kind: "cli-provider", displayName: "Fixture" },
      permissions: ["process:spawn"], activationPlanDigest: "plan", permissionConfirmation: null, enabled: true,
      installedAt: "2026-07-25T00:00:00.000Z", updatedAt: "2026-07-25T00:00:00.000Z",
    });

    const metadata: BackupMetadata = {
      version: 1, createdAt: "2026-07-25T00:00:00.000Z", towerVersion: "0.3.0", autoBackup: false,
      stats: { workspaces: 0, projects: 0, tasks: 0 }, preview: [],
    };
    const archive = await createArchive(source, backups, metadata, false);
    await extractArchive(path.join(backups, archive.filename), extracted);
    swapDirs(restored, extracted);

    const restoredDb = new PrismaClient({ datasourceUrl: `file:${path.join(restored, "database", "tower.db")}` });
    try {
      const connection = await restoredDb.providerConnection.findUniqueOrThrow({
        where: { id: "api-restored" }, include: { apiKeys: true, models: true },
      });
      expect(connection.apiKeys).toEqual([expect.objectContaining({ value: "CANARY_BACKUP_KEY_71ac", testStatus: "ok" })]);
      expect(connection.models).toEqual([expect.objectContaining({ modelId: "fixture-model" })]);
      expect(await restoredDb.aiCapabilityTarget.count({ where: { connectionId: connection.id } })).toBe(5);
      expect(await restoredDb.assistantMessage.findUnique({ where: { id: "am_11111111-1111-1111-1111-111111111111" } }))
        .toMatchObject({ partsJson: '[{"type":"text","text":"kept"}]' });

      const adapter = createApiAdapter({
        connectionId: connection.id, protocol: "openai-compatible", name: connection.name,
        baseUrl: connection.baseUrl!, headers: [], queryParams: [],
      });
      await expect(adapter.testConnection("fixture-model", {
        id: connection.apiKeys[0]!.id, value: connection.apiKeys[0]!.value,
      })).resolves.toMatchObject({ text: "OK" });
      expect(fakeApi.requests).toEqual([expect.objectContaining({
        url: "/v1/chat/completions", authorization: "Bearer CANARY_BACKUP_KEY_71ac",
      })]);
    } finally {
      await restoredDb.$disconnect();
    }

    const restoredPlugin = await new PluginRegistry({ dataRoot: restored }).get("@fixture/provider");
    expect(restoredPlugin?.installPath).toBe(path.join(restored, "ai", "plugins", "packages", "fixture-1.0.0"));
  }, 180_000);
});
