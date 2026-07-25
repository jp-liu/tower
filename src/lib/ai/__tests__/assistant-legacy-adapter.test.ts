import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { up } from "../../../../scripts/migrations/0013-assistant-sessions";
import type { SDKSessionMessage } from "@/lib/assistant-message-converter";
import { AssistantLegacyAdapter, type LegacyAssistantStore } from "../assistant-legacy-adapter";
import { AssistantSessionService } from "../assistant-session-service";

vi.mock("server-only", () => ({}));

const tempDirs: string[] = [];

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "tower-assistant-legacy-"));
  tempDirs.push(dir);
  const prisma = new PrismaClient({ datasourceUrl: `file:${join(dir, "legacy.db")}` });
  await prisma.$executeRawUnsafe(`CREATE TABLE "Workspace" ("id" TEXT NOT NULL PRIMARY KEY)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "Version" ("id" TEXT NOT NULL PRIMARY KEY)`);
  await up(prisma);
  return { dir, prisma, sessions: new AssistantSessionService(prisma) };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AssistantLegacyAdapter", () => {
  it("merges metadata and imports messages exactly once without deleting the source", async () => {
    const { dir, prisma, sessions } = await fixture();
    const legacyId = "22222222-2222-4222-8222-222222222222";
    const messages: SDKSessionMessage[] = [
      { type: "user", uuid: "u1", session_id: legacyId, parent_tool_use_id: null, message: { content: "/tower hello" } },
      { type: "assistant", uuid: "a1", session_id: legacyId, parent_tool_use_id: null, message: { content: [
        { type: "tool_use", id: "tool-1", name: "list_tasks", input: { projectId: "p1" } },
        { type: "text", text: "Done" },
      ] } },
      { type: "system", uuid: "s1", session_id: legacyId, parent_tool_use_id: null, message: {
        subtype: "tool_result", tool_name: "list_tasks", tool_use_id: "tool-1", content: "[]",
      } },
    ];
    const store: LegacyAssistantStore = {
      listSessions: vi.fn(async () => [{ sessionId: legacyId, customTitle: "Old title", createdAt: 1_700_000_000_000, lastModified: 1_700_000_100_000 }]),
      getSessionMessages: vi.fn(async () => messages),
      renameSession: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
    };
    const adapter = new AssistantLegacyAdapter(async () => store, dir);
    try {
      expect((await adapter.list())[0]?.title).toBe("Old title");
      const first = await adapter.import(legacyId, sessions);
      const second = await adapter.import(legacyId, sessions);
      expect(second.id).toBe(first.id);
      expect(store.getSessionMessages).toHaveBeenCalledTimes(1);
      expect(store.deleteSession).not.toHaveBeenCalled();
      const imported = await sessions.getMessages(first.id);
      expect(imported.some((message) => message.partsJson.includes("tool-1"))).toBe(true);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("leaves the disk source untouched when reading the legacy session fails", async () => {
    const { dir, prisma, sessions } = await fixture();
    const legacyId = "33333333-3333-4333-8333-333333333333";
    const deleteSession = vi.fn(async () => undefined);
    const store: LegacyAssistantStore = {
      listSessions: async () => [{ sessionId: legacyId, lastModified: Date.now() }],
      getSessionMessages: async () => { throw new Error("broken fixture"); },
      renameSession: async () => undefined,
      deleteSession,
    };
    const adapter = new AssistantLegacyAdapter(async () => store, dir);
    try {
      await expect(adapter.import(legacyId, sessions)).rejects.toThrow("broken fixture");
      expect(await prisma.assistantSession.count()).toBe(0);
      expect(deleteSession).not.toHaveBeenCalled();
    } finally {
      await prisma.$disconnect();
    }
  });
});
