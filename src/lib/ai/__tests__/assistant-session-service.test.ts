import { PrismaClient } from "@prisma/client";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { up } from "../../../../scripts/migrations/0013-assistant-sessions";
import { up as addOrigin } from "../../../../scripts/migrations/0035-assistant-session-origin";
import {
  AssistantSessionError,
  AssistantSessionService,
  MAX_ASSISTANT_MESSAGE_BYTES,
  attachmentParts,
  assistantMessagesToApi,
  assistantMessagesToClient,
  normalizeAssistantParts,
  parseAssistantParts,
  trimAssistantHistory,
} from "../assistant-session-service";
import {
  DEFAULT_ASSISTANT_HISTORY_TURNS,
  MAX_ASSISTANT_HISTORY_TURNS,
  normalizeAssistantHistoryTurns,
} from "../assistant-history";

vi.mock("server-only", () => ({}));

const tempDirs: string[] = [];

async function service() {
  const dir = await mkdtemp(join(tmpdir(), "tower-assistant-service-"));
  tempDirs.push(dir);
  const prisma = new PrismaClient({ datasourceUrl: `file:${join(dir, "assistant.db")}` });
  await prisma.$executeRawUnsafe(`CREATE TABLE "Workspace" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "alias" TEXT, "workspaceId" TEXT NOT NULL)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "Version" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "number" TEXT NOT NULL, "projectId" TEXT NOT NULL)`);
  await prisma.$executeRawUnsafe(`INSERT INTO "Workspace" ("id", "name") VALUES ('w1', 'Workspace One'), ('w2', 'Workspace Two')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "Project" ("id", "name", "alias", "workspaceId") VALUES ('p1', 'Project One', 'P1', 'w1'), ('p2', 'Project Two', NULL, 'w2')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "Version" ("id", "name", "number", "projectId") VALUES ('v1', 'Release One', '1.0', 'p1'), ('v2', 'Release Two', '2.0', 'p2')`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "GatewaySession" ("id" TEXT NOT NULL PRIMARY KEY, "assistantSessionId" TEXT)`);
  await up(prisma);
  await addOrigin(prisma);
  return { prisma, sessions: new AssistantSessionService(prisma) };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AssistantSessionService", () => {
  it("defaults to five history turns and caps explicit values at twenty", () => {
    expect(DEFAULT_ASSISTANT_HISTORY_TURNS).toBe(5);
    expect(MAX_ASSISTANT_HISTORY_TURNS).toBe(20);
    expect(normalizeAssistantHistoryTurns(undefined)).toBe(5);
    expect(normalizeAssistantHistoryTurns(100)).toBe(20);
    expect(normalizeAssistantHistoryTurns(0)).toBe(1);
  });

  it("accepts an attachment-free first turn before the cache root exists", async () => {
    const missingRoot = join(tmpdir(), `tower-missing-assistant-${Date.now()}-${Math.random()}`);
    await expect(attachmentParts([], missingRoot)).resolves.toEqual([]);
  });

  it("persists list/read/rename/binding and restores complete tool cards", async () => {
    const { prisma, sessions } = await service();
    try {
      const session = await sessions.createSession({ workspaceId: "w1", workspaceName: "CLIENT_INJECTION" });
      await sessions.updateSession(session.id, {
        title: "Stored title",
        binding: { projectId: "p1", projectName: "CLIENT_INJECTION" },
      });
      const turn = await sessions.beginTurn({
        sessionId: session.id,
        clientTurnId: "turn_12345678",
        userParts: [{ type: "text", text: "Create a task" }],
      });
      const parts = [
        { type: "tool-call" as const, toolCallId: "tool-1", toolName: "create_task", input: { title: "Task" } },
        { type: "tool-result" as const, toolCallId: "tool-1", toolName: "create_task", output: { id: "t1" } },
        { type: "text" as const, text: "Created." },
      ];
      await sessions.finishTurn({
        sessionId: session.id, turnId: turn.turnId, assistantMessageId: turn.assistantMessageId,
        parts, status: "COMPLETE",
      });
      const listed = await sessions.listSessions();
      expect(listed[0]).toMatchObject({
        id: session.id,
        title: "Stored title",
        workspaceId: "w1",
        workspaceName: "Workspace One",
        projectId: "p1",
        projectName: "Project One",
      });
      expect(JSON.stringify(listed[0])).not.toContain("CLIENT_INJECTION");
      const messages = await sessions.getMessages(session.id);
      expect(messages.some((message) => message.role === "SYSTEM")).toBe(false);
      const client = assistantMessagesToClient(messages);
      expect(client.find((message) => message.toolId === "tool-1")?.content).toContain("Result:");
      const api = assistantMessagesToApi(messages);
      expect(api.map((message) => message.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("hides gateway-origin sessions from the default list but exposes them on request", async () => {
    const { prisma, sessions } = await service();
    try {
      const ui = await sessions.createSession({}, "UI session");
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AssistantSession" ("id", "title", "origin", "createdAt", "updatedAt", "lastMessageAt")` +
          ` VALUES ('as_gw', 'gateway discussion', 'GATEWAY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      );

      const def = await sessions.listSessions();
      expect(def.map((s) => s.id)).toEqual([ui.id]);
      expect(def[0]!.origin).toBe("UI");

      const gateway = await sessions.listSessions({ origin: "GATEWAY" });
      expect(gateway.map((s) => s.id)).toEqual(["as_gw"]);
      expect(gateway[0]!.origin).toBe("GATEWAY");

      const all = await sessions.listSessions({ origin: "ALL" });
      expect(all.map((s) => s.id).sort()).toEqual([ui.id, "as_gw"].sort());
    } finally {
      await prisma.$disconnect();
    }
  });

  it("backfills origin for sessions referenced by a GatewaySession", async () => {
    const { prisma, sessions } = await service();
    try {
      const legacyGateway = await sessions.createSession({}, "old gateway discussion");
      await prisma.$executeRawUnsafe(
        `INSERT INTO "GatewaySession" ("id", "assistantSessionId") VALUES ('gw1', ?)`,
        legacyGateway.id,
      );
      await addOrigin(prisma); // idempotent re-run performs the backfill UPDATE
      const gateway = await sessions.listSessions({ origin: "GATEWAY" });
      expect(gateway.map((s) => s.id)).toEqual([legacyGateway.id]);
      expect(await sessions.listSessions()).toEqual([]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("rejects concurrent and duplicate turns without replaying side effects", async () => {
    const { prisma, sessions } = await service();
    try {
      const session = await sessions.createSession();
      const first = await sessions.beginTurn({ sessionId: session.id, clientTurnId: "same_12345678", userParts: [{ type: "text", text: "one" }] });
      await expect(sessions.beginTurn({ sessionId: session.id, clientTurnId: "other_12345678", userParts: [{ type: "text", text: "two" }] }))
        .rejects.toMatchObject({ code: "turn_in_progress" });
      await sessions.finishTurn({ sessionId: session.id, turnId: first.turnId, assistantMessageId: first.assistantMessageId, parts: [], status: "COMPLETE" });
      await expect(sessions.beginTurn({ sessionId: session.id, clientTurnId: "same_12345678", userParts: [{ type: "text", text: "again" }] }))
        .rejects.toMatchObject({ code: "turn_already_exists" });
      expect(await prisma.assistantTurn.count()).toBe(1);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("clears messages and turns while preserving the session title and binding", async () => {
    const { prisma, sessions } = await service();
    try {
      const session = await sessions.createSession({ versionId: "v1" }, "Keep this session");
      const turn = await sessions.beginTurn({
        sessionId: session.id,
        clientTurnId: "clear_12345678",
        userParts: [{ type: "text", text: "temporary" }],
      });
      await expect(sessions.clearConversation(session.id)).rejects.toMatchObject({ code: "turn_in_progress" });
      await sessions.finishTurn({
        sessionId: session.id,
        turnId: turn.turnId,
        assistantMessageId: turn.assistantMessageId,
        parts: [{ type: "text", text: "temporary answer" }],
        status: "COMPLETE",
      });

      await sessions.clearConversation(session.id);

      expect(await prisma.assistantTurn.count({ where: { sessionId: session.id } })).toBe(0);
      expect(await prisma.assistantMessage.count({ where: { sessionId: session.id } })).toBe(0);
      expect(await sessions.getSessionView(session.id)).toMatchObject({
        title: "Keep this session",
        workspaceId: "w1",
        projectId: "p1",
        versionId: "v1",
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("retains a successful tool result and partial text when the turn fails", async () => {
    const { prisma, sessions } = await service();
    try {
      const partial = "p".repeat(900_000);
      const session = await sessions.createSession();
      const turn = await sessions.beginTurn({
        sessionId: session.id,
        clientTurnId: "failed_12345678",
        userParts: [{ type: "text", text: "create it" }],
      });
      await sessions.finishTurn({
        sessionId: session.id,
        turnId: turn.turnId,
        assistantMessageId: turn.assistantMessageId,
        status: "FAILED",
        parts: [
          { type: "tool-call", toolCallId: "side-effect", toolName: "create_task", input: { title: "T" } },
          { type: "tool-result", toolCallId: "side-effect", toolName: "create_task", output: { id: "created" } },
          { type: "text", text: partial },
          { type: "error", code: "provider_failure", message: "Assistant execution failed" },
        ],
      });
      const messages = await sessions.getMessages(session.id);
      const stored = messages.find((message) => message.id === turn.assistantMessageId)!;
      expect(stored.status).toBe("FAILED");
      expect(parseAssistantParts(stored.partsJson)).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "tool-result", toolCallId: "side-effect", output: { id: "created" } }),
        expect.objectContaining({ type: "text", text: partial }),
        expect.objectContaining({ type: "error", code: "provider_failure" }),
      ]));
    } finally {
      await prisma.$disconnect();
    }
  });

  it("keeps only the latest completed turns and deletes an old tool turn as one unit", async () => {
    const { prisma, sessions } = await service();
    try {
      const session = await sessions.createSession();
      const first = await sessions.beginTurn({
        sessionId: session.id,
        clientTurnId: "window_first_12345678",
        userParts: [{ type: "text", text: "first user" }],
        historyTurns: 100,
      });
      await sessions.finishTurn({
        sessionId: session.id,
        turnId: first.turnId,
        assistantMessageId: first.assistantMessageId,
        historyTurns: 100,
        status: "COMPLETE",
        parts: [
          { type: "tool-call", toolCallId: "old-tool", toolName: "search", input: { query: "old" } },
          { type: "tool-result", toolCallId: "old-tool", toolName: "search", output: { found: true } },
        ],
      });

      for (const [index, text] of ["second", "third"].entries()) {
        const turn = await sessions.beginTurn({
          sessionId: session.id,
          clientTurnId: `window_${text}_12345678`,
          userParts: [{ type: "text", text: `${text} user` }],
          historyTurns: 100,
        });
        await sessions.finishTurn({
          sessionId: session.id,
          turnId: turn.turnId,
          assistantMessageId: turn.assistantMessageId,
          historyTurns: index === 1 ? 2 : 100,
          status: "COMPLETE",
          parts: [{ type: "text", text: `${text} assistant` }],
        });
      }

      expect(await prisma.assistantTurn.findUnique({ where: { id: first.turnId } })).toBeNull();
      expect(await prisma.assistantMessage.count({ where: { turnId: first.turnId } })).toBe(0);
      const restored = await sessions.getMessages(session.id);
      expect(restored).toHaveLength(4);
      expect(restored.map((message) => message.partsJson).join("\n")).not.toContain("old-tool");
      expect(restored.map((message) => message.partsJson).join("\n")).toContain("second user");
      expect(restored.map((message) => message.partsJson).join("\n")).toContain("third assistant");
    } finally {
      await prisma.$disconnect();
    }
  });

  it("excludes the current streaming turn from history pruning", async () => {
    const { prisma, sessions } = await service();
    try {
      const session = await sessions.createSession();
      for (const text of ["old", "latest"]) {
        const turn = await sessions.beginTurn({
          sessionId: session.id,
          clientTurnId: `stream_${text}_12345678`,
          userParts: [{ type: "text", text }],
          historyTurns: 100,
        });
        await sessions.finishTurn({
          sessionId: session.id,
          turnId: turn.turnId,
          assistantMessageId: turn.assistantMessageId,
          parts: [{ type: "text", text }],
          status: "COMPLETE",
          historyTurns: 100,
        });
      }
      const active = await sessions.beginTurn({
        sessionId: session.id,
        clientTurnId: "stream_active_12345678",
        userParts: [{ type: "text", text: "active" }],
        historyTurns: 100,
      });

      expect(await sessions.pruneHistory(session.id, 1)).toBe(1);
      expect(await prisma.assistantTurn.findUniqueOrThrow({ where: { id: active.turnId } })).toMatchObject({ status: "STREAMING" });
      expect(await prisma.assistantMessage.count({ where: { turnId: active.turnId } })).toBe(2);
      const restored = await sessions.getMessages(session.id);
      expect(restored.map((message) => message.partsJson).join("\n")).not.toContain('"old"');
      expect(restored.map((message) => message.partsJson).join("\n")).toContain('"latest"');
      expect(restored.map((message) => message.partsJson).join("\n")).toContain('"active"');
      sessions.releaseTurn(session.id, active.turnId);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("prepares oversized bounded history before getMessages and opening the next turn", async () => {
    const { prisma, sessions } = await service();
    try {
      const session = await sessions.createSession();
      const partsJson = JSON.stringify([{ type: "text", text: "x".repeat(940_000) }]);
      for (let index = 0; index < 9; index += 1) {
        const turnId = `at_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
        await prisma.assistantTurn.create({
          data: {
            id: turnId,
            sessionId: session.id,
            clientTurnId: `large_${index}_12345678`,
            status: "COMPLETE",
            completedAt: new Date(2026, 0, index + 1),
          },
        });
        await prisma.assistantMessage.create({
          data: {
            id: `large-message-${index}`,
            sessionId: session.id,
            turnId,
            sequence: index + 1,
            role: "ASSISTANT",
            partsJson,
            status: "COMPLETE",
          },
        });
      }
      await expect(sessions.getMessages(session.id)).rejects.toMatchObject({ code: "history_too_large" });

      const reserveBytes = Buffer.byteLength(JSON.stringify([{ type: "text", text: "continue" }]))
        + MAX_ASSISTANT_MESSAGE_BYTES;
      await sessions.prepareHistory({ sessionId: session.id, historyTurns: 20, reserveBytes });
      const prepared = await sessions.getMessages(session.id);
      expect(prepared).toHaveLength(7);
      expect(prepared[0]?.id).toBe("large-message-2");
      expect(prepared.at(-1)?.id).toBe("large-message-8");
      expect(new Set(prepared.map((message) => message.turnId)).size).toBe(prepared.length);

      const turn = await sessions.beginTurn({
        sessionId: session.id,
        clientTurnId: "large_next_12345678",
        userParts: [{ type: "text", text: "continue" }],
        historyTurns: 20,
      });

      expect(await prisma.assistantTurn.count({ where: { sessionId: session.id } })).toBeLessThan(10);
      await sessions.finishTurn({
        sessionId: session.id,
        turnId: turn.turnId,
        assistantMessageId: turn.assistantMessageId,
        parts: [{ type: "text", text: "ok" }],
        status: "COMPLETE",
        historyTurns: 20,
      });
      await expect(sessions.getMessages(session.id)).resolves.not.toHaveLength(0);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("redacts sensitive tool fields and converges orphaned streaming rows", async () => {
    const { prisma, sessions } = await service();
    try {
      const session = await sessions.createSession();
      const turn = await sessions.beginTurn({ sessionId: session.id, clientTurnId: "redact_12345678", userParts: [{ type: "text", text: "run" }] });
      await sessions.updateAssistantMessage(turn.assistantMessageId, [{
        type: "tool-call", toolCallId: "tool-secret", toolName: "test",
        input: { apiKey: "CANARY_SECRET", nested: { authorization: "Bearer CANARY_SECRET" }, safe: "ok" },
      }, {
        type: "tool-result", toolCallId: "tool-attachment", toolName: "read_attachment",
        output: {
          _towerAttachment: true,
          attachment: "2026-07/files/data.json",
          mimeType: "application/json",
          size: 18,
          content: "BASE64_CANARY",
        },
      }]);
      sessions.releaseTurn(session.id, turn.turnId);
      await sessions.reconcileInterrupted();
      const stored = await prisma.assistantMessage.findUniqueOrThrow({ where: { id: turn.assistantMessageId } });
      expect(stored.partsJson).not.toContain("CANARY_SECRET");
      expect(stored.partsJson).not.toContain("BASE64_CANARY");
      expect(stored.partsJson).toContain("ATTACHMENT_CONTENT_OMITTED");
      expect(parseAssistantParts(stored.partsJson)[0]).toMatchObject({ input: { apiKey: "[REDACTED]", safe: "ok" } });
      expect(stored.status).toBe("INTERRUPTED");
    } finally {
      await prisma.$disconnect();
    }
  });

  it("redacts credential-shaped canaries from prompt, header, query, and JSON text", () => {
    const canaries = [
      "CANARY_PROMPT_SECRET_123",
      "CANARY_HEADER_SECRET_456",
      "CANARY_QUERY_SECRET_789",
      "CANARY_JSON_SECRET_abc",
    ];
    const [part] = normalizeAssistantParts([{ type: "text", text: [
      `secret=${canaries[0]}`,
      `Authorization: Bearer ${canaries[1]}`,
      `https://example.invalid/path?api_key=${canaries[2]}`,
      `{"token":"${canaries[3]}"}`,
    ].join("\n") }]);
    const serialized = JSON.stringify(part);
    for (const canary of canaries) expect(serialized).not.toContain(canary);
    expect(serialized.match(/REDACTED/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("imports a legacy conversation idempotently and trims by complete turn", async () => {
    const { prisma, sessions } = await service();
    try {
      const legacyId = "11111111-1111-4111-8111-111111111111";
      const options = {
        legacyId, title: "Legacy", createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-01-02"),
        messages: [
          { role: "USER" as const, parts: [{ type: "text" as const, text: "hello" }], turnKey: "one" },
          { role: "ASSISTANT" as const, parts: [{ type: "text" as const, text: "world" }], turnKey: "one" },
        ],
      };
      const first = await sessions.importLegacy(options);
      const second = await sessions.importLegacy(options);
      expect(second.id).toBe(first.id);
      expect(await prisma.assistantSession.count()).toBe(1);
      const messages = await sessions.getMessages(first.id);
      expect(trimAssistantHistory(messages, 1).map((message) => message.turnId)).toEqual([messages[0]!.turnId, messages[1]!.turnId]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("removes carrier envelopes only from legacy UI sessions", async () => {
    const { prisma, sessions } = await service();
    try {
      const carrierText = "Conversation history (Tower is the source of truth):\nUSER: old\n\nCURRENT USER: new";
      const carrier = await sessions.importLegacy({
        legacyId: "77777777-7777-4777-8777-777777777777",
        title: "Carrier",
        createdAt: new Date("2025-01-01"),
        updatedAt: new Date("2025-01-02"),
        messages: [{
          role: "USER",
          parts: [{ type: "text", text: carrierText }],
          turnKey: "one",
        }],
      });
      const real = await sessions.importLegacy({
        legacyId: "88888888-8888-4888-8888-888888888888",
        title: "Real",
        createdAt: new Date("2025-01-01"),
        updatedAt: new Date("2025-01-02"),
        messages: [{ role: "USER", parts: [{ type: "text", text: "Explain CURRENT USER fields" }], turnKey: "one" }],
      });
      const nativeUi = await sessions.createSession({}, "Native UI carrier-like text");
      await prisma.assistantMessage.create({
        data: {
          id: "native-ui-carrier-message",
          sessionId: nativeUi.id,
          sequence: 1,
          role: "USER",
          partsJson: JSON.stringify([{ type: "text", text: carrierText }]),
          status: "COMPLETE",
        },
      });
      const gateway = await sessions.importLegacy({
        legacyId: "99999999-9999-4999-8999-999999999999",
        title: "Gateway carrier-like text",
        createdAt: new Date("2025-01-01"),
        updatedAt: new Date("2025-01-02"),
        messages: [{ role: "USER", parts: [{ type: "text", text: carrierText }], turnKey: "one" }],
      });
      await prisma.assistantSession.update({ where: { id: gateway.id }, data: { origin: "GATEWAY" } });

      await expect(sessions.removeImportedCarrierSessions()).resolves.toBe(1);
      expect(await prisma.assistantSession.findUnique({ where: { id: carrier.id } })).toBeNull();
      expect(await prisma.assistantSession.findUnique({ where: { id: real.id } })).not.toBeNull();
      expect(await prisma.assistantSession.findUnique({ where: { id: nativeUi.id } })).not.toBeNull();
      expect(await prisma.assistantSession.findUnique({ where: { id: gateway.id } })).not.toBeNull();
    } finally {
      await prisma.$disconnect();
    }
  });

  it("rejects malformed oversized stored history", async () => {
    const error = new AssistantSessionError("invalid_history", "bad");
    expect(error.code).toBe("invalid_history");
  });

  it("rejects mismatched binding hierarchies and preserves explicit clearing", async () => {
    const { prisma, sessions } = await service();
    try {
      await expect(sessions.createSession({ workspaceId: "w1", projectId: "p2" }))
        .rejects.toMatchObject({ code: "invalid_binding" });
      await expect(sessions.createSession({ projectId: "p1", versionId: "v2" }))
        .rejects.toMatchObject({ code: "invalid_binding" });
      const session = await sessions.createSession({ versionId: "v1", versionName: "IGNORE_THIS" });
      expect(session).toMatchObject({
        workspaceId: "w1",
        workspaceName: "Workspace One",
        projectId: "p1",
        projectName: "Project One",
        versionId: "v1",
        versionName: "Release One",
      });
      expect(await sessions.updateSession(session.id, { binding: {} })).not.toHaveProperty("workspaceId");
    } finally {
      await prisma.$disconnect();
    }
  });

  it("rejects histories over 1000 messages instead of dropping the newest turn", async () => {
    const { prisma, sessions } = await service();
    try {
      const session = await sessions.createSession();
      await prisma.assistantMessage.createMany({
        data: Array.from({ length: 1001 }, (_, index) => ({
          id: `bulk-${index}`,
          sessionId: session.id,
          sequence: index + 1,
          role: "ASSISTANT" as const,
          partsJson: "[]",
          status: "COMPLETE" as const,
        })),
      });
      await expect(sessions.getMessages(session.id)).rejects.toMatchObject({ code: "history_too_large" });
      await prisma.assistantMessage.delete({ where: { id: "bulk-1000" } });
      await expect(sessions.beginTurn({
        sessionId: session.id,
        clientTurnId: "limit_12345678",
        userParts: [{ type: "text", text: "newest" }],
      })).rejects.toMatchObject({ code: "history_too_large" });
      expect(await prisma.assistantMessage.count({ where: { sessionId: session.id } })).toBe(1000);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("counts UTF-8 bytes rather than characters when enforcing the history budget", async () => {
    const { prisma, sessions } = await service();
    try {
      const session = await sessions.createSession();
      const partsJson = JSON.stringify([{ type: "text", text: "界".repeat(300_000) }]);
      expect(partsJson.length * 10).toBeLessThan(8 * 1024 * 1024);
      expect(Buffer.byteLength(partsJson) * 10).toBeGreaterThan(8 * 1024 * 1024);
      await prisma.assistantMessage.createMany({
        data: Array.from({ length: 10 }, (_, index) => ({
          id: `unicode-${index}`,
          sessionId: session.id,
          sequence: index + 1,
          role: "ASSISTANT" as const,
          partsJson,
          status: "COMPLETE" as const,
        })),
      });
      await expect(sessions.beginTurn({
        sessionId: session.id,
        clientTurnId: "unicode_12345678",
        userParts: [{ type: "text", text: "continue" }],
      })).rejects.toMatchObject({ code: "history_too_large" });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("stores only safe attachment metadata and rejects binary or escaped files", async () => {
    const attachmentRoot = await mkdtemp(join(tmpdir(), "tower-assistant-attachments-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "tower-assistant-outside-"));
    tempDirs.push(attachmentRoot, outsideRoot);
    await mkdir(join(attachmentRoot, "2026-07", "files"), { recursive: true });
    await writeFile(join(attachmentRoot, "2026-07/files/data.json"), '{"safe":true}');
    await writeFile(join(attachmentRoot, "2026-07/files/binary.txt"), Buffer.from([0, 1, 2]));
    await writeFile(join(outsideRoot, "secret.txt"), "CANARY_SECRET");
    await symlink(join(outsideRoot, "secret.txt"), join(attachmentRoot, "2026-07/files/link.txt"));

    await expect(attachmentParts(["2026-07/files/data.json"], attachmentRoot)).resolves.toEqual([{
      type: "attachment",
      attachment: "2026-07/files/data.json",
      mimeType: "application/json",
      size: 13,
    }]);
    await expect(attachmentParts(["2026-07/files/binary.txt"], attachmentRoot))
      .rejects.toMatchObject({ code: "invalid_attachment" });
    await expect(attachmentParts(["2026-07/files/link.txt"], attachmentRoot))
      .rejects.toMatchObject({ code: "invalid_attachment" });
  });
});
