import { PrismaClient } from "@prisma/client";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { up } from "../../../../scripts/migrations/0013-assistant-sessions";
import {
  AssistantSessionError,
  AssistantSessionService,
  attachmentParts,
  assistantMessagesToApi,
  assistantMessagesToClient,
  parseAssistantParts,
  trimAssistantHistory,
} from "../assistant-session-service";

vi.mock("server-only", () => ({}));

const tempDirs: string[] = [];

async function service() {
  const dir = await mkdtemp(join(tmpdir(), "tower-assistant-service-"));
  tempDirs.push(dir);
  const prisma = new PrismaClient({ datasourceUrl: `file:${join(dir, "assistant.db")}` });
  await prisma.$executeRawUnsafe(`CREATE TABLE "Workspace" ("id" TEXT NOT NULL PRIMARY KEY)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "Version" ("id" TEXT NOT NULL PRIMARY KEY)`);
  await prisma.$executeRawUnsafe(`INSERT INTO "Workspace" ("id") VALUES ('w1')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "Project" ("id") VALUES ('p1')`);
  await up(prisma);
  return { prisma, sessions: new AssistantSessionService(prisma) };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AssistantSessionService", () => {
  it("persists list/read/rename/binding and restores complete tool cards", async () => {
    const { prisma, sessions } = await service();
    try {
      const session = await sessions.createSession({ workspaceId: "w1", workspaceName: "Work" });
      await sessions.updateSession(session.id, {
        title: "Stored title",
        binding: { projectId: "p1", projectName: "Project" },
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
      expect(listed[0]).toMatchObject({ id: session.id, title: "Stored title", projectId: "p1" });
      const messages = await sessions.getMessages(session.id);
      const client = assistantMessagesToClient(messages);
      expect(client.find((message) => message.toolId === "tool-1")?.content).toContain("Result:");
      const api = assistantMessagesToApi(messages);
      expect(api.map((message) => message.role)).toEqual(["user", "assistant", "tool", "assistant"]);
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

  it("rejects malformed oversized stored history", async () => {
    const error = new AssistantSessionError("invalid_history", "bad");
    expect(error.code).toBe("invalid_history");
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
