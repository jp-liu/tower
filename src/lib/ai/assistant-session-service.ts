import "server-only";

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ApiMessage, ApiMessageContentPart } from "@tower/ai-runtime";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { ATTACHMENT_SUBPATH_RE, MAX_ATTACHMENTS, classifyAttachmentSubPath } from "@/lib/attachment-utils";
import { getAssistantCacheRoot } from "@/lib/file-utils";
import { detectImageMime, isLikelyTextFile, TEXT_EXT_TO_MIME } from "@/lib/mime-magic";

export const MAX_ASSISTANT_SESSIONS = 50;
export const MAX_ASSISTANT_MESSAGES = 1000;
export const MAX_ASSISTANT_PARTS = 128;
export const MAX_ASSISTANT_MESSAGE_BYTES = 1024 * 1024;
export const MAX_ASSISTANT_HISTORY_BYTES = 8 * 1024 * 1024;
const MAX_TOOL_SUMMARY_BYTES = 32 * 1024;

export const towerSessionIdSchema = z.string().regex(/^as_[0-9a-f-]{36}$/i);
export const legacySessionIdSchema = z.string().uuid();
export const assistantSessionIdSchema = z.union([towerSessionIdSchema, legacySessionIdSchema]);
export const assistantMessageIdSchema = z.string().regex(/^am_[0-9a-f-]{36}$/i);
export const assistantTurnIdSchema = z.string().regex(/^at_[0-9a-f-]{36}$/i);
export const clientTurnIdSchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/);

const textPartSchema = z.object({ type: z.literal("text"), text: z.string().max(MAX_ASSISTANT_MESSAGE_BYTES) });
const reasoningPartSchema = z.object({ type: z.literal("reasoning"), text: z.string().max(MAX_ASSISTANT_MESSAGE_BYTES) });
const toolCallPartSchema = z.object({
  type: z.literal("tool-call"),
  toolCallId: z.string().min(1).max(256),
  toolName: z.string().min(1).max(256),
  input: z.unknown(),
});
const toolResultPartSchema = z.object({
  type: z.literal("tool-result"),
  toolCallId: z.string().min(1).max(256),
  toolName: z.string().min(1).max(256),
  output: z.unknown(),
  isError: z.boolean().optional(),
});
const attachmentPartSchema = z.object({
  type: z.literal("attachment"),
  attachment: z.string().regex(ATTACHMENT_SUBPATH_RE),
  mimeType: z.string().min(1).max(255),
  size: z.number().int().nonnegative().max(50 * 1024 * 1024),
});
const diagnosticPartSchema = z.object({
  type: z.enum(["error", "notice"]),
  code: z.string().min(1).max(128),
  message: z.string().max(16 * 1024),
});

export const assistantPartSchema = z.discriminatedUnion("type", [
  textPartSchema,
  reasoningPartSchema,
  toolCallPartSchema,
  toolResultPartSchema,
  attachmentPartSchema,
  diagnosticPartSchema,
]);
export const assistantPartsSchema = z.array(assistantPartSchema).max(MAX_ASSISTANT_PARTS);
export type AssistantPart = z.infer<typeof assistantPartSchema>;

export interface AssistantBinding {
  workspaceId?: string;
  workspaceName?: string;
  projectId?: string;
  projectName?: string;
  versionId?: string;
  versionName?: string;
}

export interface AssistantSessionView extends AssistantBinding {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  legacy?: boolean;
}

type DbClient = PrismaClient;
type StoredMessage = {
  id: string;
  sessionId: string;
  turnId: string | null;
  sequence: number;
  role: string;
  partsJson: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

const SENSITIVE_KEY = /(authorization|api[-_]?key|token|secret|password|passwd|credential|cookie|headers?|query|env)/i;

function redactString(value: string): string {
  let result = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]");
  for (const [key, secret] of Object.entries(process.env)) {
    if (!SENSITIVE_KEY.test(key) || !secret || secret.length < 8) continue;
    result = result.split(secret).join("[REDACTED]");
  }
  return result;
}

/** Central persistence boundary for tool inputs/results and safe diagnostics. */
export function redactAssistantValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return redactString(value).slice(0, MAX_TOOL_SUMMARY_BYTES);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redactAssistantValue(entry, depth + 1));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record._towerAttachment === true) {
      return {
        _towerAttachment: true,
        attachment: typeof record.attachment === "string" && ATTACHMENT_SUBPATH_RE.test(record.attachment)
          ? record.attachment
          : "attachment",
        mimeType: typeof record.mimeType === "string" ? record.mimeType.slice(0, 255) : "application/octet-stream",
        size: typeof record.size === "number" ? record.size : undefined,
        content: "[ATTACHMENT_CONTENT_OMITTED]",
      };
    }
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactAssistantValue(entry, depth + 1),
    ]));
  }
  return String(value ?? "").slice(0, MAX_TOOL_SUMMARY_BYTES);
}

export function normalizeAssistantParts(parts: AssistantPart[]): AssistantPart[] {
  const parsed = assistantPartsSchema.parse(parts).map((part) => {
    if (part.type === "tool-call") return { ...part, input: redactAssistantValue(part.input) };
    if (part.type === "tool-result") return { ...part, output: redactAssistantValue(part.output) };
    if (part.type === "text" || part.type === "reasoning") return { ...part, text: redactString(part.text) };
    if (part.type === "error" || part.type === "notice") return { ...part, message: redactString(part.message) };
    return part;
  });
  const serialized = JSON.stringify(parsed);
  if (Buffer.byteLength(serialized) > MAX_ASSISTANT_MESSAGE_BYTES) {
    throw new AssistantSessionError("message_too_large", "Assistant message is too large");
  }
  return parsed;
}

export function parseAssistantParts(partsJson: string): AssistantPart[] {
  if (Buffer.byteLength(partsJson) > MAX_ASSISTANT_MESSAGE_BYTES) {
    throw new AssistantSessionError("invalid_history", "Stored Assistant message is too large");
  }
  try {
    return assistantPartsSchema.parse(JSON.parse(partsJson));
  } catch {
    throw new AssistantSessionError("invalid_history", "Stored Assistant history is invalid");
  }
}

export class AssistantSessionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AssistantSessionError";
  }
}

interface ActiveTurn {
  turnId: string;
  controller: AbortController;
}

const globalAssistant = globalThis as typeof globalThis & {
  __towerAssistantTurns?: Map<string, ActiveTurn>;
};
const activeTurns = globalAssistant.__towerAssistantTurns ??= new Map<string, ActiveTurn>();

export function abortAssistantTurn(sessionId: string): void {
  activeTurns.get(sessionId)?.controller.abort();
}

export function isAssistantTurnActive(turnId: string): boolean {
  return [...activeTurns.values()].some((active) => active.turnId === turnId);
}

function id(prefix: "as" | "am" | "at"): string {
  return `${prefix}_${randomUUID()}`;
}

const bindingSchema = z.object({
  workspaceId: z.string().min(1).max(128).optional(),
  workspaceName: z.string().max(256).optional(),
  projectId: z.string().min(1).max(128).optional(),
  projectName: z.string().max(256).optional(),
  versionId: z.string().min(1).max(128).optional(),
  versionName: z.string().max(256).optional(),
}).strict();

function bindingIds(binding: AssistantBinding) {
  const safe = bindingSchema.parse(binding);
  return { workspaceId: safe.workspaceId, projectId: safe.projectId, versionId: safe.versionId };
}

function sessionView(session: {
  id: string; title: string; workspaceId: string | null; workspaceNameSnapshot: string | null;
  projectId: string | null; projectNameSnapshot: string | null; versionId: string | null;
  versionNameSnapshot: string | null; legacySource: string | null; createdAt: Date; updatedAt: Date;
  lastMessageAt: Date;
}): AssistantSessionView {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    lastMessageAt: session.lastMessageAt.toISOString(),
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    ...(session.workspaceNameSnapshot ? { workspaceName: session.workspaceNameSnapshot } : {}),
    ...(session.projectId ? { projectId: session.projectId } : {}),
    ...(session.projectNameSnapshot ? { projectName: session.projectNameSnapshot } : {}),
    ...(session.versionId ? { versionId: session.versionId } : {}),
    ...(session.versionNameSnapshot ? { versionName: session.versionNameSnapshot } : {}),
    ...(session.legacySource ? { legacy: true } : {}),
  };
}

export class AssistantSessionService {
  constructor(private readonly client: DbClient = db) {}

  private async bindingData(binding: AssistantBinding) {
    const requested = bindingIds(binding);
    const version = requested.versionId ? await this.client.version.findUnique({
      where: { id: requested.versionId },
      select: { id: true, name: true, number: true, projectId: true },
    }) : null;
    if (requested.versionId && !version) {
      throw new AssistantSessionError("invalid_binding", "Assistant version scope is invalid");
    }

    const projectId = requested.projectId ?? version?.projectId;
    if (requested.projectId && version && version.projectId !== requested.projectId) {
      throw new AssistantSessionError("invalid_binding", "Assistant version does not belong to the selected project");
    }
    const project = projectId ? await this.client.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, workspaceId: true },
    }) : null;
    if (projectId && !project) {
      throw new AssistantSessionError("invalid_binding", "Assistant project scope is invalid");
    }

    const workspaceId = requested.workspaceId ?? project?.workspaceId;
    if (requested.workspaceId && project && project.workspaceId !== requested.workspaceId) {
      throw new AssistantSessionError("invalid_binding", "Assistant project does not belong to the selected workspace");
    }
    const workspace = workspaceId ? await this.client.workspace.findUnique({
      where: { id: workspaceId }, select: { id: true, name: true },
    }) : null;
    if (workspaceId && !workspace) {
      throw new AssistantSessionError("invalid_binding", "Assistant workspace scope is invalid");
    }

    return {
      workspaceId: workspace?.id ?? null,
      workspaceNameSnapshot: workspace?.name ?? null,
      projectId: project?.id ?? null,
      projectNameSnapshot: project?.name ?? null,
      versionId: version?.id ?? null,
      versionNameSnapshot: version ? version.name || version.number : null,
    };
  }

  async reconcileInterrupted(): Promise<void> {
    const streaming = await this.client.assistantTurn.findMany({
      where: { status: "STREAMING" }, select: { id: true, sessionId: true }, take: 100,
    });
    const stale = streaming.filter((turn) => !isAssistantTurnActive(turn.id));
    if (!stale.length) return;
    const ids = stale.map((turn) => turn.id);
    await this.client.$transaction([
      this.client.assistantTurn.updateMany({
        where: { id: { in: ids }, status: "STREAMING" },
        data: { status: "INTERRUPTED", completedAt: new Date() },
      }),
      this.client.assistantMessage.updateMany({
        where: { turnId: { in: ids }, status: "STREAMING" }, data: { status: "INTERRUPTED" },
      }),
    ]);
  }

  async createSession(binding: AssistantBinding = {}, title = "New Session") {
    const session = await this.client.assistantSession.create({
      data: {
        id: id("as"),
        title: title.trim().slice(0, 120) || "New Session",
        ...await this.bindingData(binding),
      },
    });
    return sessionView(session);
  }

  async listSessions(limit = MAX_ASSISTANT_SESSIONS): Promise<AssistantSessionView[]> {
    await this.reconcileInterrupted();
    const sessions = await this.client.assistantSession.findMany({
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
      take: Math.min(MAX_ASSISTANT_SESSIONS, Math.max(1, limit)),
    });
    return sessions.map(sessionView);
  }

  async getSession(sessionId: string) {
    towerSessionIdSchema.parse(sessionId);
    await this.reconcileInterrupted();
    const session = await this.client.assistantSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new AssistantSessionError("session_not_found", "Assistant session was not found");
    return session;
  }

  async getSessionView(sessionId: string): Promise<AssistantSessionView> {
    return sessionView(await this.getSession(sessionId));
  }

  async listImportedLegacyIds(): Promise<Set<string>> {
    const rows = await this.client.assistantSession.findMany({
      where: { legacySource: "claude-agent-sdk", legacyId: { not: null } },
      select: { legacyId: true }, take: MAX_ASSISTANT_SESSIONS,
    });
    return new Set(rows.flatMap((row) => row.legacyId ? [row.legacyId] : []));
  }

  async findImportedLegacy(legacyId: string) {
    legacySessionIdSchema.parse(legacyId);
    return this.client.assistantSession.findUnique({
      where: { legacySource_legacyId: { legacySource: "claude-agent-sdk", legacyId } },
    });
  }

  async updateSession(sessionId: string, update: { title?: string; binding?: AssistantBinding }) {
    towerSessionIdSchema.parse(sessionId);
    const data: Record<string, unknown> = {};
    if (update.title !== undefined) {
      const title = z.string().trim().min(1).max(120).parse(update.title);
      data.title = title;
    }
    if (update.binding !== undefined) Object.assign(data, await this.bindingData(update.binding));
    const session = await this.client.assistantSession.update({ where: { id: sessionId }, data });
    return sessionView(session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    towerSessionIdSchema.parse(sessionId);
    abortAssistantTurn(sessionId);
    await this.client.assistantSession.delete({ where: { id: sessionId } });
  }

  async getMessages(sessionId: string): Promise<StoredMessage[]> {
    await this.getSession(sessionId);
    const messages = await this.client.assistantMessage.findMany({
      where: { sessionId }, orderBy: { sequence: "asc" }, take: MAX_ASSISTANT_MESSAGES + 1,
    });
    if (messages.length > MAX_ASSISTANT_MESSAGES) {
      throw new AssistantSessionError("history_too_large", "Assistant session has too many messages");
    }
    let bytes = 0;
    for (const message of messages) {
      bytes += Buffer.byteLength(message.partsJson);
      if (bytes > MAX_ASSISTANT_HISTORY_BYTES) {
        throw new AssistantSessionError("history_too_large", "Assistant session history is too large");
      }
      parseAssistantParts(message.partsJson);
    }
    return messages;
  }

  async beginTurn(options: {
    sessionId: string; clientTurnId: string; userParts: AssistantPart[];
  }): Promise<{ turnId: string; userMessageId: string; assistantMessageId: string; controller: AbortController }> {
    towerSessionIdSchema.parse(options.sessionId);
    clientTurnIdSchema.parse(options.clientTurnId);
    const userParts = normalizeAssistantParts(options.userParts);
    const current = activeTurns.get(options.sessionId);
    if (current) {
      current.controller.abort();
      throw new AssistantSessionError("turn_in_progress", "The previous turn is being cancelled; retry this message once it settles");
    }

    const turnId = id("at");
    const controller = new AbortController();
    activeTurns.set(options.sessionId, { turnId, controller });
    const userMessageId = id("am");
    const assistantMessageId = id("am");
    try {
      await this.getSession(options.sessionId);
      const bytes = await this.client.$queryRawUnsafe<Array<{ bytes: bigint | number | null }>>(
        `SELECT SUM(LENGTH(CAST("partsJson" AS BLOB))) AS "bytes" FROM "AssistantMessage" WHERE "sessionId" = ?`,
        options.sessionId,
      );
      const incomingBytes = Buffer.byteLength(JSON.stringify(userParts)) + Buffer.byteLength("[]");
      if (Number(bytes[0]?.bytes ?? 0) + incomingBytes > MAX_ASSISTANT_HISTORY_BYTES) {
        throw new AssistantSessionError("history_too_large", "Assistant session history is too large");
      }
      await this.client.$transaction(async (transaction) => {
        const duplicate = await transaction.assistantTurn.findUnique({
          where: { sessionId_clientTurnId: { sessionId: options.sessionId, clientTurnId: options.clientTurnId } },
        });
        if (duplicate) throw new AssistantSessionError("turn_already_exists", "This turn was already submitted");
        const lastMessage = await transaction.assistantMessage.findFirst({
          where: { sessionId: options.sessionId }, orderBy: { sequence: "desc" }, select: { sequence: true },
        });
        const messageCount = await transaction.assistantMessage.count({ where: { sessionId: options.sessionId } });
        if (messageCount + 2 > MAX_ASSISTANT_MESSAGES) {
          throw new AssistantSessionError("history_too_large", "Assistant session has too many messages");
        }
        const firstSequence = (lastMessage?.sequence ?? 0) + 1;
        await transaction.assistantTurn.create({
          data: { id: turnId, sessionId: options.sessionId, clientTurnId: options.clientTurnId, userMessageId, assistantMessageId },
        });
        await transaction.assistantMessage.createMany({ data: [
          { id: userMessageId, sessionId: options.sessionId, turnId, sequence: firstSequence, role: "USER", partsJson: JSON.stringify(userParts), status: "COMPLETE" },
          { id: assistantMessageId, sessionId: options.sessionId, turnId, sequence: firstSequence + 1, role: "ASSISTANT", partsJson: "[]", status: "STREAMING" },
        ] });
        const firstText = userParts.find((part): part is z.infer<typeof textPartSchema> => part.type === "text")?.text.trim();
        const userMessageCount = firstText
          ? await transaction.assistantMessage.count({ where: { sessionId: options.sessionId, role: "USER" } })
          : 0;
        await transaction.assistantSession.update({
          where: { id: options.sessionId },
          data: { lastMessageAt: new Date() },
        });
        if (firstText && userMessageCount === 1) {
          await transaction.assistantSession.updateMany({
            where: { id: options.sessionId, title: "New Session" },
            data: { title: firstText.slice(0, 30) },
          });
        }
      });
      return { turnId, userMessageId, assistantMessageId, controller };
    } catch (error) {
      activeTurns.delete(options.sessionId);
      throw error;
    }
  }

  async updateAssistantMessage(messageId: string, parts: AssistantPart[]): Promise<void> {
    assistantMessageIdSchema.parse(messageId);
    const safe = normalizeAssistantParts(parts);
    await this.client.assistantMessage.update({ where: { id: messageId }, data: { partsJson: JSON.stringify(safe) } });
  }

  async finishTurn(options: {
    sessionId: string; turnId: string; assistantMessageId: string; parts: AssistantPart[];
    status: "COMPLETE" | "INTERRUPTED" | "FAILED";
  }): Promise<void> {
    const parts = normalizeAssistantParts(options.parts);
    await this.client.$transaction([
      this.client.assistantMessage.update({
        where: { id: options.assistantMessageId }, data: { partsJson: JSON.stringify(parts), status: options.status },
      }),
      this.client.assistantTurn.update({
        where: { id: options.turnId }, data: { status: options.status, completedAt: new Date() },
      }),
      this.client.assistantSession.update({
        where: { id: options.sessionId }, data: { lastMessageAt: new Date() },
      }),
    ]);
    if (activeTurns.get(options.sessionId)?.turnId === options.turnId) activeTurns.delete(options.sessionId);
  }

  releaseTurn(sessionId: string, turnId: string): void {
    if (activeTurns.get(sessionId)?.turnId === turnId) activeTurns.delete(sessionId);
  }

  async importLegacy(options: {
    legacyId: string; title: string; createdAt: Date; updatedAt: Date;
    messages: Array<{ role: "USER" | "ASSISTANT" | "SYSTEM"; parts: AssistantPart[]; turnKey?: string }>;
  }) {
    legacySessionIdSchema.parse(options.legacyId);
    const existing = await this.findImportedLegacy(options.legacyId);
    if (existing) return existing;
    const sessionId = id("as");
    try {
      await this.client.$transaction(async (transaction) => {
        await transaction.assistantSession.create({ data: {
          id: sessionId,
          title: options.title.trim().slice(0, 120) || "New Session",
          legacySource: "claude-agent-sdk",
          legacyId: options.legacyId,
          createdAt: options.createdAt,
          updatedAt: options.updatedAt,
          lastMessageAt: options.updatedAt,
        } });
        const turnIds = new Map<string, string>();
        let sequence = 0;
        for (const message of options.messages.slice(0, 1000)) {
          const turnId = message.turnKey
            ? turnIds.get(message.turnKey) ?? id("at")
            : undefined;
          if (message.turnKey && turnId && !turnIds.has(message.turnKey)) {
            turnIds.set(message.turnKey, turnId);
            await transaction.assistantTurn.create({
              data: { id: turnId, sessionId, clientTurnId: `legacy_${message.turnKey}`.slice(0, 128), status: "COMPLETE", completedAt: options.updatedAt },
            });
          }
          await transaction.assistantMessage.create({ data: {
            id: id("am"), sessionId, turnId, sequence: ++sequence, role: message.role,
            partsJson: JSON.stringify(normalizeAssistantParts(message.parts)), status: "COMPLETE",
            createdAt: options.createdAt, updatedAt: options.updatedAt,
          } });
        }
      });
    } catch (error) {
      const imported = await this.findImportedLegacy(options.legacyId);
      if (imported) return imported;
      throw error;
    }
    return this.client.assistantSession.findUniqueOrThrow({ where: { id: sessionId } });
  }
}

export async function attachmentParts(filenames: string[], root = getAssistantCacheRoot()): Promise<AssistantPart[]> {
  const unique = [...new Set(filenames)];
  if (unique.length > MAX_ATTACHMENTS || unique.some((filename) => !ATTACHMENT_SUBPATH_RE.test(filename))) {
    throw new AssistantSessionError("invalid_attachment", "One or more attachments are invalid");
  }
  const realRoot = await fs.realpath(root);
  return Promise.all(unique.map(async (attachment) => {
    const unresolved = path.resolve(realRoot, attachment);
    const resolved = await fs.realpath(unresolved);
    if (resolved !== realRoot && !resolved.startsWith(`${realRoot}${path.sep}`)) {
      throw new AssistantSessionError("invalid_attachment", "One or more attachments are invalid");
    }
    const stat = await fs.stat(resolved);
    if (!stat.isFile() || stat.size > 50 * 1024 * 1024) {
      throw new AssistantSessionError("invalid_attachment", "One or more attachments are invalid");
    }
    const kind = classifyAttachmentSubPath(attachment);
    if (!kind) throw new AssistantSessionError("invalid_attachment", "One or more attachments are invalid");
    const sample = Buffer.alloc(Math.min(stat.size, 8 * 1024));
    const handle = await fs.open(resolved, "r");
    try {
      await handle.read(sample, 0, sample.length, 0);
    } finally {
      await handle.close();
    }
    const extension = path.extname(attachment).toLowerCase();
    let mimeType = TEXT_EXT_TO_MIME[extension] ?? "text/plain";
    if (kind === "image") {
      const detected = detectImageMime(sample);
      if (!detected) throw new AssistantSessionError("invalid_attachment", "One or more attachments are invalid");
      mimeType = detected;
    } else if (!isLikelyTextFile(sample)) {
      throw new AssistantSessionError("invalid_attachment", "One or more attachments are invalid");
    }
    return { type: "attachment" as const, attachment, mimeType, size: stat.size };
  }));
}

export function assistantMessagesToApi(messages: StoredMessage[]): ApiMessage[] {
  const result: ApiMessage[] = [];
  for (const message of messages) {
    const parts = parseAssistantParts(message.partsJson);
    if (message.role === "USER") {
      const text = parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      const attachments = parts.filter((part) => part.type === "attachment")
        .map((part) => `[Attachment: ${part.attachment} (${part.mimeType}, ${part.size} bytes)]`).join("\n");
      result.push({ role: "user", content: [text, attachments].filter(Boolean).join("\n") });
      continue;
    }
    let assistant: ApiMessageContentPart[] = [];
    const flush = () => {
      if (assistant.length) result.push({ role: "assistant", content: assistant });
      assistant = [];
    };
    for (const part of parts) {
      if (part.type === "text" || part.type === "reasoning") assistant.push(part);
      if (part.type === "tool-call") assistant.push({ type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName, input: part.input });
      if (part.type === "tool-result") {
        flush();
        result.push({ role: "tool", content: [{
          type: "tool-result", toolCallId: part.toolCallId, toolName: part.toolName,
          output: { type: part.isError ? "error-json" : "json", value: part.output },
        }] });
      }
      if (part.type === "error" || part.type === "notice") assistant.push({ type: "text", text: `[${part.code}] ${part.message}` });
    }
    flush();
  }
  return result;
}

/** Drop oldest complete turns as units; never split a tool call/result pair. */
export function trimAssistantHistory(messages: StoredMessage[], maxBytes = 512 * 1024): StoredMessage[] {
  const groups = new Map<string, StoredMessage[]>();
  for (const message of messages) {
    const key = message.turnId ?? `message:${message.id}`;
    groups.set(key, [...(groups.get(key) ?? []), message]);
  }
  const ordered = [...groups.values()];
  let bytes = ordered.reduce((sum, group) => sum + group.reduce((n, message) => n + Buffer.byteLength(message.partsJson), 0), 0);
  while (ordered.length > 1 && bytes > maxBytes) {
    const removed = ordered.shift()!;
    bytes -= removed.reduce((sum, message) => sum + Buffer.byteLength(message.partsJson), 0);
  }
  return ordered.flat();
}

export interface AssistantClientMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolId?: string;
  attachmentFilenames?: string[];
  status?: string;
}

export function assistantMessagesToClient(messages: StoredMessage[]): AssistantClientMessage[] {
  const result: AssistantClientMessage[] = [];
  const tools = new Map<string, number>();
  for (const message of messages) {
    const parts = parseAssistantParts(message.partsJson);
    if (message.role === "USER") {
      const content = parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      const attachmentFilenames = parts.filter((part) => part.type === "attachment").map((part) => part.attachment);
      result.push({
        id: message.id, role: "user", content, status: message.status,
        ...(attachmentFilenames.length ? { attachmentFilenames } : {}),
      });
      continue;
    }
    let textIndex = 0;
    for (const part of parts) {
      if (part.type === "text") {
        result.push({ id: `${message.id}-text-${textIndex++}`, role: "assistant", content: part.text, status: message.status });
      } else if (part.type === "tool-call") {
        const index = result.length;
        tools.set(part.toolCallId, index);
        result.push({
          id: `${message.id}-tool-${part.toolCallId}`, role: "tool",
          content: JSON.stringify(part.input, null, 2), toolName: part.toolName,
          toolId: part.toolCallId, status: message.status,
        });
      } else if (part.type === "tool-result") {
        const index = tools.get(part.toolCallId);
        const output = typeof part.output === "string" ? part.output : JSON.stringify(part.output, null, 2);
        if (index !== undefined) {
          const previous = result[index]!;
          result[index] = { ...previous, content: `${previous.content}\n\nResult:\n${output}`, status: message.status };
        } else {
          result.push({
            id: `${message.id}-tool-result-${part.toolCallId}`, role: "tool", content: output,
            toolName: part.toolName, toolId: part.toolCallId, status: message.status,
          });
        }
      } else if (part.type === "error" || part.type === "notice") {
        result.push({ id: `${message.id}-${part.type}-${textIndex++}`, role: "assistant", content: part.message, status: message.status });
      }
    }
  }
  return result;
}

export const assistantSessionService = new AssistantSessionService();
