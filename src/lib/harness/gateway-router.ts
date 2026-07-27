import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type {
  GatewayDeliveryKind,
  GatewayRequestKind,
  GatewaySessionKind,
  Prisma,
} from "@prisma/client";
import { continueOrStartTaskExecution } from "@/actions/agent-actions";
import { db } from "@/lib/db";
import { readConfigValue } from "@/lib/config-reader";
import { ensureTowerTask } from "@/lib/instrumentation-tasks";
import { logger } from "@/lib/logger";
import { scoreProject } from "@/lib/project-score";
import {
  enqueueWorkbenchEvent,
  openWorkbenchDrainBoundary,
  restoreWorkbenchDrainBoundary,
} from "@/lib/workbench/coordinator";
import { extractTowerTaskId, findHarnessDeliveryByPlatformMessageId } from "./delivery-map";
import { parseGatewaySendOutput } from "./gateway-output";
import {
  discussionPresentation,
  extractTaskGoal,
  finalResultPresentation,
  queuedPresentation,
  taskCreatedPresentation,
  type GatewayMessagePresentation,
} from "./gateway-presentation";
import { sendViaHarnessGateway, type HarnessGatewaySendResult } from "./gateway-send";

export const GATEWAY_CHANNEL_BINDINGS_KEY = "harness.channelBindings";
export const GATEWAY_RECENT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const INBOUND_CLAIM_LEASE_MS = 60_000;
const DELIVERY_RETRY_BASE_MS = 5_000;
const DELIVERY_RETRY_MAX_MS = 5 * 60_000;
const DISCUSSION_HISTORY_CHAR_LIMIT = 12_000;
const log = logger.create("gateway-router");

export interface GatewayChannelBinding {
  gateway?: string;
  platform: string;
  chatId: string;
  defaultWorkspaceId?: string;
  allowedProjectIds?: string[];
  defaultProjectId?: string;
}

export interface GatewayInboundRequest {
  gateway: string;
  platform: string;
  chatId: string;
  platformMessageId: string;
  senderId?: string;
  threadId?: string;
  rootMessageId?: string;
  replyToMessageId?: string;
  quotedText?: string;
  taskId?: string;
  project?: string;
  intent: GatewayRequestKind;
  content: string;
  sessionAction?: "CONTINUE" | "NEW" | "CLOSE";
  startNewWork?: boolean;
}

export interface GatewayProjectCandidate {
  projectId: string;
  name: string;
  alias: string | null;
  workspaceId: string;
  workspaceName: string;
}

type GatewayProject = GatewayProjectCandidate & { description: string | null };

export type GatewayRouteResult =
  | {
      mode: "in_progress" | "already_processed";
      inboundId: string;
      deduped: true;
      noOp: true;
      state: "PROCESSING" | "QUEUED" | "PROCESSED";
      originalMode?: string;
    }
  | {
      mode: "task_reply";
      inboundId: string;
      taskId: string;
      project: GatewayProjectCandidate;
      resolution: "reply_binding";
      deduped: boolean;
    }
  | {
      mode: "gateway_direct" | "tower_mcp";
      inboundId: string;
      deduped: boolean;
      instructions: string;
    }
  | {
      mode: "needs_project_selection";
      inboundId: string;
      deduped: boolean;
      candidates: GatewayProjectCandidate[];
      reason: "ambiguous" | "not_found" | "not_allowed";
    }
  | {
      mode: "project_discussion";
      inboundId: string;
      sessionId: string;
      assistantSessionId: string;
      project: GatewayProjectCandidate;
      resolution: string;
      deduped: boolean;
      instructions: string;
      history: {
        messages: Array<{ role: "USER" | "ASSISTANT"; text: string }>;
        truncated: boolean;
      };
    }
  | {
      mode: "project_work";
      inboundId: string;
      sessionId: string;
      workbenchTaskId: string;
      project: GatewayProjectCandidate;
      resolution: string;
      deduped: boolean;
      queued: true;
      acknowledgement: { ok: boolean; deduped?: boolean; error?: string };
      workbench: { mode: string; executionId: string | null } | { error: string };
      instructions: string;
    }
  | {
      mode: "discussion_closed";
      inboundId: string;
      closedSessionIds: string[];
      deduped: boolean;
      instructions: string;
    };

type EnsureWorkbench = (taskId: string) => Promise<{
  mode: string;
  executionId: string | null;
}>;

type DeliverySender = (input: Parameters<typeof sendViaHarnessGateway>[0]) => Promise<HarnessGatewaySendResult>;

let deliveryRetryTimer: ReturnType<typeof setTimeout> | null = null;
let deliveryRetryScheduledAt: number | null = null;

function scheduleGatewayDeliveryRetry(nextAttemptAt: Date, sender: DeliverySender): void {
  const scheduledAt = Math.max(Date.now(), nextAttemptAt.getTime());
  if (deliveryRetryTimer && deliveryRetryScheduledAt !== null && deliveryRetryScheduledAt <= scheduledAt) return;
  if (deliveryRetryTimer) clearTimeout(deliveryRetryTimer);
  deliveryRetryScheduledAt = scheduledAt;
  deliveryRetryTimer = setTimeout(() => {
    deliveryRetryTimer = null;
    deliveryRetryScheduledAt = null;
    void retryGatewayDeliveries(sender).catch((error) => {
      log.warn("Scheduled gateway delivery retry failed", error);
      scheduleGatewayDeliveryRetry(new Date(Date.now() + DELIVERY_RETRY_BASE_MS), sender);
    });
  }, Math.max(0, scheduledAt - Date.now()));
  if (typeof deliveryRetryTimer === "object" && "unref" in deliveryRetryTimer) {
    deliveryRetryTimer.unref();
  }
}

export function resetGatewayDeliveryRetrySchedulerForTests(): void {
  if (deliveryRetryTimer) clearTimeout(deliveryRetryTimer);
  deliveryRetryTimer = null;
  deliveryRetryScheduledAt = null;
}

function normalize(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeChatId(value: string | null | undefined): string {
  return normalize(value).replace(/^(feishu|lark|wechat|weixin):/, "");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

function candidate(project: GatewayProject): GatewayProjectCandidate {
  return {
    projectId: project.projectId,
    name: project.name,
    alias: project.alias,
    workspaceId: project.workspaceId,
    workspaceName: project.workspaceName,
  };
}

function inboundDedupKey(input: GatewayInboundRequest): string {
  return `gateway-inbound:${normalize(input.gateway)}:${normalize(input.platform)}:${normalizeChatId(input.chatId)}:${input.platformMessageId.trim()}`;
}

function sessionAnchor(input: GatewayInboundRequest): string {
  const thread = input.threadId?.trim() || input.rootMessageId?.trim();
  if (thread) return `thread:${thread}`;
  const sender = normalize(input.senderId);
  return sender ? `sender:${sender}` : `message:${input.platformMessageId.trim()}`;
}

function sessionBindingKey(input: GatewayInboundRequest, kind: GatewaySessionKind, projectId: string): string {
  return `gateway-session:${digest([
    normalize(input.gateway),
    normalize(input.platform),
    normalizeChatId(input.chatId),
    sessionAnchor(input),
    kind,
    projectId,
  ].join("\n"))}`;
}

function explicitlyStartsNewWork(input: GatewayInboundRequest): boolean {
  if (input.startNewWork) return true;
  if (input.intent !== "PROJECT_WORK") return false;
  return /(?:创建|新建).{0,8}新任务|开始.{0,8}新工作|create.{0,16}new task|start.{0,16}new work/iu
    .test(input.content);
}

async function loadProjects(where?: Prisma.ProjectWhereInput): Promise<GatewayProject[]> {
  const rows = await db.project.findMany({
    where,
    include: { workspace: { select: { id: true, name: true } } },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
  });
  return rows.map((project) => ({
    projectId: project.id,
    name: project.name,
    alias: project.alias,
    description: project.description,
    workspaceId: project.workspaceId,
    workspaceName: project.workspace.name,
  }));
}

async function channelBinding(input: GatewayInboundRequest): Promise<GatewayChannelBinding | null> {
  const bindings = await readConfigValue<GatewayChannelBinding[]>(GATEWAY_CHANNEL_BINDINGS_KEY, []);
  const platform = normalize(input.platform);
  const chatId = normalizeChatId(input.chatId);
  return (Array.isArray(bindings) ? bindings : []).find((binding) => {
    if (!binding?.platform || !binding.chatId) return false;
    if (normalize(binding.platform) !== platform || normalizeChatId(binding.chatId) !== chatId) return false;
    return !binding.gateway || normalize(binding.gateway) === normalize(input.gateway);
  }) ?? null;
}

function projectAllowed(
  projectId: string,
  binding: GatewayChannelBinding | null,
  workspaceId?: string,
): boolean {
  if (binding?.defaultWorkspaceId && workspaceId && binding.defaultWorkspaceId !== workspaceId) return false;
  const allowed = binding?.allowedProjectIds?.filter(Boolean) ?? [];
  return allowed.length === 0 || allowed.includes(projectId);
}

async function taskProject(taskId: string): Promise<{ taskId: string; project: GatewayProject } | null> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      project: {
        select: {
          id: true,
          name: true,
          alias: true,
          description: true,
          workspaceId: true,
          workspace: { select: { name: true } },
        },
      },
    },
  });
  if (!task) return null;
  return {
    taskId: task.id,
    project: {
      projectId: task.project.id,
      name: task.project.name,
      alias: task.project.alias,
      description: task.project.description,
      workspaceId: task.project.workspaceId,
      workspaceName: task.project.workspace.name,
    },
  };
}

async function resolveTaskBinding(input: GatewayInboundRequest) {
  if (input.replyToMessageId?.trim()) {
    const harness = await findHarnessDeliveryByPlatformMessageId(input.replyToMessageId);
    if (harness) return taskProject(harness.taskId);

    const gatewayDelivery = await db.gatewayDelivery.findFirst({
      where: { platformMessageId: input.replyToMessageId.trim(), state: "DELIVERED" },
      orderBy: { deliveredAt: "desc" },
      select: { inbound: { select: { createdTaskId: true } } },
    });
    if (gatewayDelivery?.inbound?.createdTaskId) {
      return taskProject(gatewayDelivery.inbound.createdTaskId);
    }
  }

  const explicitTaskId = input.taskId?.trim()
    || extractTowerTaskId(input.quotedText)
    || extractTowerTaskId(input.content);
  return explicitTaskId ? taskProject(explicitTaskId) : null;
}

async function resolveBoundSession(input: GatewayInboundRequest) {
  const anchors = [input.replyToMessageId, input.threadId, input.rootMessageId]
    .map((value) => value?.trim())
    .filter(Boolean) as string[];
  const base = {
    gateway: normalize(input.gateway),
    platform: normalize(input.platform),
    chatId: normalizeChatId(input.chatId),
  };
  if (anchors.length === 0) {
    const senderId = input.senderId?.trim();
    if (!senderId) return null;
    return db.gatewaySession.findFirst({
      where: {
        ...base,
        status: "ACTIVE",
        senderId,
        kind: input.intent === "PROJECT_DISCUSSION" ? "DISCUSSION" : "WORKBENCH",
        lastActivityAt: { gte: new Date(Date.now() - GATEWAY_RECENT_SESSION_TTL_MS) },
      },
      orderBy: { lastActivityAt: "desc" },
      include: { project: { include: { workspace: { select: { name: true } } } } },
    });
  }
  return db.gatewaySession.findFirst({
    where: {
      ...base,
      status: { in: ["ACTIVE", "CLOSED"] },
      OR: [
        { threadId: { in: anchors } },
        { rootMessageId: { in: anchors } },
      ],
    },
    orderBy: { lastActivityAt: "desc" },
    include: { project: { include: { workspace: { select: { name: true } } } } },
  });
}

async function resolveProject(
  input: GatewayInboundRequest,
  binding: GatewayChannelBinding | null,
  options: { ignoreSessionBindings?: boolean } = {},
): Promise<
  | { project: GatewayProject; resolution: string }
  | { candidates: GatewayProjectCandidate[]; reason: "ambiguous" | "not_found" | "not_allowed" }
> {
  if (!options.ignoreSessionBindings && input.replyToMessageId?.trim()) {
    const delivery = await db.gatewayDelivery.findFirst({
      where: { platformMessageId: input.replyToMessageId.trim(), state: "DELIVERED" },
      orderBy: { deliveredAt: "desc" },
      include: { session: { include: { project: { include: { workspace: { select: { name: true } } } } } } },
    });
    if (delivery?.session) {
      const project = delivery.session.project;
      if (!projectAllowed(project.id, binding, project.workspaceId)) return { candidates: [], reason: "not_allowed" };
      return {
        project: {
          projectId: project.id,
          name: project.name,
          alias: project.alias,
          description: project.description,
          workspaceId: project.workspaceId,
          workspaceName: project.workspace.name,
        },
        resolution: "reply_message_binding",
      };
    }
  }

  const boundSession = options.ignoreSessionBindings ? null : await resolveBoundSession(input);
  if (boundSession) {
    if (!projectAllowed(boundSession.projectId, binding, boundSession.project.workspaceId)) {
      return { candidates: [], reason: "not_allowed" };
    }
    return {
      project: {
        projectId: boundSession.project.id,
        name: boundSession.project.name,
        alias: boundSession.project.alias,
        description: boundSession.project.description,
        workspaceId: boundSession.project.workspaceId,
        workspaceName: boundSession.project.workspace.name,
      },
      resolution: "thread_session_binding",
    };
  }

  const scope: Prisma.ProjectWhereInput = {
    ...(binding?.defaultWorkspaceId ? { workspaceId: binding.defaultWorkspaceId } : {}),
    ...(binding?.allowedProjectIds?.length ? { id: { in: binding.allowedProjectIds } } : {}),
  };
  const projects = await loadProjects(scope);
  const explicit = input.project?.trim();
  if (explicit) {
    const exact = projects.filter((project) =>
      project.projectId === explicit
      || normalize(project.name) === normalize(explicit)
      || (!!project.alias && normalize(project.alias) === normalize(explicit))
    );
    if (exact.length === 1) return { project: exact[0], resolution: "explicit_project" };
    if (exact.length > 1) return { candidates: exact.map(candidate), reason: "ambiguous" };

    const identified = projects
      .map((project) => ({ project, confidence: scoreProject(project, explicit) }))
      .filter((item) => item.confidence >= 0.3)
      .sort((a, b) => b.confidence - a.confidence);
    if (identified.length === 1) return { project: identified[0].project, resolution: "identify_project" };
    if (identified.length > 1) return { candidates: identified.map((item) => candidate(item.project)), reason: "ambiguous" };

    const unrestricted = await db.project.findFirst({
      where: {
        OR: [
          { id: explicit },
          { name: { equals: explicit } },
          { alias: { equals: explicit } },
        ],
      },
      select: { id: true },
    });
    return { candidates: [], reason: unrestricted ? "not_allowed" : "not_found" };
  }

  if (input.senderId?.trim()) {
    const recent = await db.gatewaySession.findFirst({
      where: {
        gateway: normalize(input.gateway),
        platform: normalize(input.platform),
        senderId: input.senderId.trim(),
        status: "ACTIVE",
        lastActivityAt: { gte: new Date(Date.now() - GATEWAY_RECENT_SESSION_TTL_MS) },
        ...(binding?.defaultWorkspaceId ? { project: { workspaceId: binding.defaultWorkspaceId } } : {}),
        ...(binding?.allowedProjectIds?.length ? { projectId: { in: binding.allowedProjectIds } } : {}),
      },
      orderBy: { lastActivityAt: "desc" },
      include: { project: { include: { workspace: { select: { name: true } } } } },
    });
    if (recent) {
      return {
        project: {
          projectId: recent.project.id,
          name: recent.project.name,
          alias: recent.project.alias,
          description: recent.project.description,
          workspaceId: recent.project.workspaceId,
          workspaceName: recent.project.workspace.name,
        },
        resolution: "recent_user_project",
      };
    }
  }

  if (binding?.defaultProjectId) {
    const found = projects.find((project) => project.projectId === binding.defaultProjectId);
    if (found) return { project: found, resolution: "channel_default_project" };
    return { candidates: projects.map(candidate), reason: "not_allowed" };
  }
  return { candidates: projects.map(candidate), reason: projects.length > 1 ? "ambiguous" : "not_found" };
}

async function createInbound(input: GatewayInboundRequest) {
  const dedupKey = inboundDedupKey(input);
  try {
    const inbound = await db.gatewayInbound.create({
      data: {
        dedupKey,
        gateway: normalize(input.gateway),
        platform: normalize(input.platform),
        chatId: normalizeChatId(input.chatId),
        senderId: input.senderId?.trim() || null,
        platformMessageId: input.platformMessageId.trim(),
        threadId: input.threadId?.trim() || null,
        rootMessageId: input.rootMessageId?.trim() || null,
        replyToMessageId: input.replyToMessageId?.trim() || null,
        intent: input.intent,
        content: input.content.trim(),
      },
    });
    return { inbound, deduped: false };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return {
      inbound: await db.gatewayInbound.findUniqueOrThrow({ where: { dedupKey } }),
      deduped: true,
    };
  }
}

async function saveRoute(
  inboundId: string,
  result: GatewayRouteResult,
  state: "PROCESSING" | "PROCESSED" | "QUEUED",
): Promise<void> {
  await db.gatewayInbound.update({
    where: { id: inboundId },
    data: {
      state,
      response: JSON.stringify(result),
      processedAt: state === "PROCESSED" ? new Date() : null,
      attempts: { increment: 1 },
      lastError: null,
    },
  });
}

async function ensureSession(
  input: GatewayInboundRequest,
  kind: GatewaySessionKind,
  project: GatewayProject,
  workbenchTaskId?: string,
) {
  const bindingKey = sessionBindingKey(input, kind, project.projectId);
  const existing = await db.gatewaySession.findUnique({ where: { bindingKey } });
  if (existing) {
    return db.gatewaySession.update({
      where: { id: existing.id },
      data: {
        status: "ACTIVE",
        senderId: input.senderId?.trim() || existing.senderId,
        lastActivityAt: new Date(),
        ...(workbenchTaskId ? { workbenchTaskId } : {}),
      },
    });
  }

  try {
    return await db.$transaction(async (transaction) => {
      let assistantSessionId: string | null = null;
      if (kind === "DISCUSSION") {
        assistantSessionId = `as_${randomUUID()}`;
        await transaction.assistantSession.create({
          data: {
            id: assistantSessionId,
            title: `${project.name} gateway discussion`,
            workspaceId: project.workspaceId,
            workspaceNameSnapshot: project.workspaceName,
            projectId: project.projectId,
            projectNameSnapshot: project.name,
          },
        });
      }
      return transaction.gatewaySession.create({
        data: {
          bindingKey,
          gateway: normalize(input.gateway),
          platform: normalize(input.platform),
          chatId: normalizeChatId(input.chatId),
          threadId: input.threadId?.trim() || null,
          rootMessageId: input.rootMessageId?.trim() || input.platformMessageId.trim(),
          senderId: input.senderId?.trim() || null,
          kind,
          projectId: project.projectId,
          workbenchTaskId: workbenchTaskId ?? null,
          assistantSessionId,
        },
      });
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return db.gatewaySession.update({
      where: { bindingKey },
      data: {
        status: "ACTIVE",
        senderId: input.senderId?.trim() || null,
        lastActivityAt: new Date(),
        ...(workbenchTaskId ? { workbenchTaskId } : {}),
      },
    });
  }
}

function discussionClientTurnId(inboundId: string): string {
  return `gateway_${inboundId}`;
}

async function discussionHistoryTurns(): Promise<number> {
  const configured = await readConfigValue<number>("assistant.historyTurns", 20);
  if (!Number.isFinite(configured)) return 20;
  return Math.min(100, Math.max(1, Math.trunc(configured)));
}

async function closeDiscussionSessions(
  input: GatewayInboundRequest,
  rotateBindingKey = false,
): Promise<string[]> {
  const anchors = [input.threadId, input.rootMessageId]
    .map((value) => value?.trim())
    .filter(Boolean) as string[];
  const repliedDelivery = input.replyToMessageId?.trim()
    ? await db.gatewayDelivery.findFirst({
        where: { platformMessageId: input.replyToMessageId.trim(), state: "DELIVERED" },
        select: { sessionId: true },
      })
    : null;
  const rows = await db.gatewaySession.findMany({
    where: {
      gateway: normalize(input.gateway),
      platform: normalize(input.platform),
      chatId: normalizeChatId(input.chatId),
      kind: "DISCUSSION",
      status: "ACTIVE",
      ...(repliedDelivery
        ? { id: repliedDelivery.sessionId }
        : anchors.length > 0
          ? { OR: [{ threadId: { in: anchors } }, { rootMessageId: { in: anchors } }] }
          : input.senderId?.trim()
            ? { senderId: input.senderId.trim() }
            : { id: "__missing_discussion_binding__" }),
    },
    select: { id: true, bindingKey: true },
  });
  if (rows.length === 0) return [];
  await db.$transaction(rows.map((row) => db.gatewaySession.update({
    where: { id: row.id },
    data: {
      status: "CLOSED",
      ...(rotateBindingKey ? { bindingKey: `${row.bindingKey}:closed:${row.id}` } : {}),
    },
  })));
  return rows.map((row) => row.id);
}

async function beginDiscussionTurn(sessionId: string, inboundId: string, content: string): Promise<void> {
  const clientTurnId = discussionClientTurnId(inboundId);
  await db.$transaction(async (transaction) => {
    const existing = await transaction.assistantTurn.findUnique({
      where: { sessionId_clientTurnId: { sessionId, clientTurnId } },
      select: { id: true },
    });
    if (existing) return;
    const last = await transaction.assistantMessage.findFirst({
      where: { sessionId },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    const turnId = `at_${randomUUID()}`;
    const userMessageId = `am_${randomUUID()}`;
    const assistantMessageId = `am_${randomUUID()}`;
    const sequence = (last?.sequence ?? -1) + 1;
    await transaction.assistantTurn.create({
      data: { id: turnId, sessionId, clientTurnId, userMessageId, assistantMessageId },
    });
    await transaction.assistantMessage.createMany({ data: [
      {
        id: userMessageId,
        sessionId,
        turnId,
        sequence,
        role: "USER",
        partsJson: JSON.stringify([{ type: "text", text: content.trim() }]),
        status: "COMPLETE",
      },
      {
        id: assistantMessageId,
        sessionId,
        turnId,
        sequence: sequence + 1,
        role: "ASSISTANT",
        partsJson: "[]",
        status: "STREAMING",
      },
    ] });
    await transaction.assistantSession.update({
      where: { id: sessionId },
      data: { lastMessageAt: new Date() },
    });
  });
}

function textFromParts(partsJson: string): string {
  try {
    const parts = JSON.parse(partsJson) as Array<{ type?: string; text?: string }>;
    return parts.filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text!.trim())
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

async function loadDiscussionHistory(sessionId: string): Promise<{
  messages: Array<{ role: "USER" | "ASSISTANT"; text: string }>;
  truncated: boolean;
}> {
  const keepTurns = await discussionHistoryTurns();
  const turns = await db.assistantTurn.findMany({
    where: { sessionId, status: "COMPLETE" },
    orderBy: [{ completedAt: "desc" }, { startedAt: "desc" }],
    take: keepTurns + 1,
    include: { messages: { orderBy: { sequence: "asc" } } },
  });
  let truncated = turns.length > keepTurns;
  const messages = turns.slice(0, keepTurns).reverse().flatMap((turn) =>
    turn.messages.flatMap((message) => {
      if (message.role !== "USER" && message.role !== "ASSISTANT") return [];
      const text = textFromParts(message.partsJson);
      return text ? [{ role: message.role, text }] : [];
    }),
  );
  let chars = messages.reduce((sum, message) => sum + message.text.length, 0);
  while (messages.length > 0 && chars > DISCUSSION_HISTORY_CHAR_LIMIT) {
    chars -= messages.shift()!.text.length;
    truncated = true;
  }
  return { messages, truncated };
}

async function completeDiscussionTurn(inboundId: string, response: string): Promise<string> {
  const inbound = await db.gatewayInbound.findUnique({
    where: { id: inboundId },
    select: { session: { select: { assistantSessionId: true } } },
  });
  const sessionId = inbound?.session?.assistantSessionId;
  if (!sessionId) throw new Error("Gateway discussion Assistant session not found");
  const requested = response.trim();
  const canonical = await db.$transaction(async (transaction) => {
    const turn = await transaction.assistantTurn.findUnique({
      where: { sessionId_clientTurnId: { sessionId, clientTurnId: discussionClientTurnId(inboundId) } },
      include: { messages: { where: { role: "ASSISTANT" }, take: 1 } },
    });
    if (!turn?.messages[0]) throw new Error("Gateway discussion turn not found");
    const message = turn.messages[0];
    if (turn.status === "COMPLETE") return textFromParts(message.partsJson) || requested;
    const claimed = await transaction.assistantTurn.updateMany({
      // Assistant startup reconciliation may mark externally generated gateway
      // turns INTERRUPTED because they do not occupy its process-local active map.
      // Any non-complete gateway turn is still recoverable by this durable callback.
      where: { id: turn.id, status: { not: "COMPLETE" } },
      data: { status: "COMPLETE", completedAt: new Date() },
    });
    if (claimed.count === 0) {
      const settled = await transaction.assistantMessage.findUniqueOrThrow({ where: { id: message.id } });
      return textFromParts(settled.partsJson) || requested;
    }
    await transaction.assistantMessage.update({
      where: { id: message.id },
      data: { partsJson: JSON.stringify([{ type: "text", text: requested }]), status: "COMPLETE" },
    });
    await transaction.assistantSession.update({ where: { id: sessionId }, data: { lastMessageAt: new Date() } });
    return requested;
  });
  const expired = await db.assistantTurn.findMany({
    where: { sessionId, status: { not: "STREAMING" } },
    orderBy: [{ completedAt: "desc" }, { startedAt: "desc" }],
    // Keep a bounded Tower-owned audit history while the configurable window
    // below controls how many recent turns are restored into each agent turn.
    skip: 100,
    select: { id: true },
  });
  if (expired.length > 0) {
    const ids = expired.map((item) => item.id);
    await db.$transaction([
      db.assistantMessage.deleteMany({ where: { sessionId, turnId: { in: ids } } }),
      db.assistantTurn.deleteMany({ where: { sessionId, id: { in: ids }, status: { not: "STREAMING" } } }),
    ]);
  }
  return canonical;
}

async function defaultEnsureWorkbench(taskId: string) {
  const result = await continueOrStartTaskExecution(taskId);
  return { mode: result.mode, executionId: result.executionId };
}

function workbenchPrompt(input: GatewayInboundRequest, inboundId: string, project: GatewayProject): string {
  return [
    "[Gateway project work request]",
    `Project: ${project.name} (id: ${project.projectId})`,
    `Gateway inbound ID: ${inboundId}`,
    `Source: ${input.platform}:${input.chatId}`,
    input.threadId ? `Thread: ${input.threadId}` : null,
    input.rootMessageId ? `Root message: ${input.rootMessageId}` : null,
    "",
    input.content.trim(),
    "",
    "Handle this as the resident project Workbench. Research and dispatch through create_task; do not implement the work in the Workbench terminal. Only after create_task returns a real task id, call confirm_gateway_task_created with this inbound id and that task id. After the child result is reviewed and accepted, call complete_gateway_work with the same inbound id, the task id, and the reviewed result summary. Those tools own idempotent replies to the original external thread.",
  ].filter((line) => line !== null).join("\n");
}

export async function routeGatewayInbound(
  input: GatewayInboundRequest,
  ensureWorkbench: EnsureWorkbench = defaultEnsureWorkbench,
  sender: DeliverySender = sendViaHarnessGateway,
): Promise<GatewayRouteResult> {
  const created = await createInbound(input);
  if (created.deduped && !created.inbound.response) {
    if (Date.now() - created.inbound.updatedAt.getTime() < INBOUND_CLAIM_LEASE_MS) {
      return {
        mode: "in_progress",
        inboundId: created.inbound.id,
        deduped: true,
        noOp: true,
        state: created.inbound.state === "QUEUED" ? "QUEUED" : "PROCESSING",
      };
    }
    await db.gatewayInbound.update({
      where: { id: created.inbound.id },
      data: { attempts: { increment: 1 }, lastError: "Recovered stale inbound routing claim" },
    });
  }
  if (created.deduped && created.inbound.response) {
    if (created.inbound.state === "PROCESSED") {
      return {
        mode: "already_processed",
        inboundId: created.inbound.id,
        deduped: true,
        noOp: true,
        state: "PROCESSED",
      };
    }
    const cached = JSON.parse(created.inbound.response) as GatewayRouteResult;
    if (created.inbound.state === "QUEUED") {
      return {
        mode: "in_progress",
        inboundId: created.inbound.id,
        deduped: true,
        noOp: true,
        state: "QUEUED",
        originalMode: cached.mode,
      };
    }
    if (created.inbound.state === "PROCESSING") {
      const recoverable = cached.mode === "project_discussion";
      const stale = Date.now() - created.inbound.updatedAt.getTime() >= INBOUND_CLAIM_LEASE_MS;
      if (!recoverable || !stale) {
        return {
          mode: "in_progress",
          inboundId: created.inbound.id,
          deduped: true,
          noOp: true,
          state: "PROCESSING",
          originalMode: cached.mode,
        };
      }
      await db.gatewayInbound.update({
        where: { id: created.inbound.id },
        data: { attempts: { increment: 1 }, lastError: `Recovered stale ${cached.mode} claim` },
      });
      return { ...cached, deduped: true };
    }
    return {
      mode: "already_processed",
      inboundId: created.inbound.id,
      deduped: true,
      noOp: true,
      state: "PROCESSED",
      originalMode: cached.mode,
    };
  }

  const binding = await channelBinding(input);
  if (input.sessionAction === "CLOSE") {
    const closedSessionIds = await closeDiscussionSessions(input);
    const result: GatewayRouteResult = {
      mode: "discussion_closed",
      inboundId: created.inbound.id,
      closedSessionIds,
      deduped: created.deduped,
      instructions: closedSessionIds.length > 0
        ? "The Tower discussion binding is closed. Confirm closure without continuing the old project context."
        : "No active Tower discussion binding matched this message. Confirm that there was nothing to close.",
    };
    await saveRoute(created.inbound.id, result, "PROCESSED");
    return result;
  }
  if (input.sessionAction === "NEW") await closeDiscussionSessions(input, true);

  const reply = explicitlyStartsNewWork(input) || input.sessionAction === "NEW"
    ? null
    : await resolveTaskBinding(input);
  if (reply) {
    if (!projectAllowed(reply.project.projectId, binding, reply.project.workspaceId)) {
      const denied: GatewayRouteResult = {
        mode: "needs_project_selection",
        inboundId: created.inbound.id,
        deduped: created.deduped,
        candidates: [],
        reason: "not_allowed",
      };
      await saveRoute(created.inbound.id, denied, "PROCESSED");
      return denied;
    }
    const result: GatewayRouteResult = {
      mode: "task_reply",
      inboundId: created.inbound.id,
      taskId: reply.taskId,
      project: candidate(reply.project),
      resolution: "reply_binding",
      deduped: created.deduped,
    };
    await saveRoute(created.inbound.id, result, "PROCESSING");
    return result;
  }

  if (input.intent === "DIRECT" || input.intent === "TOWER") {
    const result: GatewayRouteResult = {
      mode: input.intent === "DIRECT" ? "gateway_direct" : "tower_mcp",
      inboundId: created.inbound.id,
      deduped: created.deduped,
      instructions: input.intent === "DIRECT"
        ? "Answer directly in the gateway or delegate to a configured external operator. Do not start a project Workbench."
        : "Handle this with Tower MCP tools in the gateway. Do not start a project Workbench for a query or simple command, and only confirm mutations after the tool succeeds.",
    };
    await saveRoute(created.inbound.id, result, "PROCESSED");
    return result;
  }

  const resolved = await resolveProject(input, binding, {
    ignoreSessionBindings: input.sessionAction === "NEW",
  });
  if ("candidates" in resolved) {
    const result: GatewayRouteResult = {
      mode: "needs_project_selection",
      inboundId: created.inbound.id,
      deduped: created.deduped,
      candidates: resolved.candidates,
      reason: resolved.reason,
    };
    await saveRoute(created.inbound.id, result, "PROCESSED");
    return result;
  }

  if (input.intent === "PROJECT_DISCUSSION") {
    const session = await ensureSession(input, "DISCUSSION", resolved.project);
    await beginDiscussionTurn(session.assistantSessionId!, created.inbound.id, input.content);
    const history = await loadDiscussionHistory(session.assistantSessionId!);
    const result: GatewayRouteResult = {
      mode: "project_discussion",
      inboundId: created.inbound.id,
      sessionId: session.id,
      assistantSessionId: session.assistantSessionId!,
      project: candidate(resolved.project),
      resolution: resolved.resolution,
      deduped: created.deduped,
      history,
      instructions: `You are discussing the ${resolved.project.name} project with Tower-owned history. Use projectId=${resolved.project.projectId} for ask_project_knowledge and other scoped Tower tools. Use the returned history messages as recent context${history.truncated ? "; earlier turns were truncated" : ""}. Do not answer as an unbound general Tower assistant. Prepare the project-aware response, then call complete_gateway_discussion with inboundId=${created.inbound.id}; that tool persists the assistant turn, sends one idempotent native card replying to the current inbound message, and releases this turn's execution resources.`,
    };
    await db.gatewayInbound.update({ where: { id: created.inbound.id }, data: { sessionId: session.id } });
    await saveRoute(created.inbound.id, result, "PROCESSING");
    return result;
  }

  const workbenchTaskId = await ensureTowerTask(resolved.project.projectId, resolved.project.name);
  const session = await ensureSession(input, "WORKBENCH", resolved.project, workbenchTaskId);
  await db.gatewayInbound.update({
    where: { id: created.inbound.id },
    data: { sessionId: session.id, state: "QUEUED" },
  });
  await enqueueWorkbenchEvent({
    parentTaskId: workbenchTaskId,
    sourceTaskId: workbenchTaskId,
    kind: "GATEWAY_WORK_REQUEST",
    priority: "NORMAL",
    dedupKey: `gateway-work:${created.inbound.id}`,
    payload: {
      childTaskId: workbenchTaskId,
      childTitle: `${resolved.project.name} gateway request`,
      gatewayInboundId: created.inbound.id,
      gatewaySessionId: session.id,
      gatewayMessage: workbenchPrompt(input, created.inbound.id, resolved.project),
    },
  });

  let workbench: { mode: string; executionId: string | null } | { error: string };
  try {
    workbench = await ensureWorkbench(workbenchTaskId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    workbench = { error: message };
    await db.gatewayInbound.update({
      where: { id: created.inbound.id },
      data: { lastError: message.slice(0, 2000) },
    });
  }
  const result: GatewayRouteResult = {
    mode: "project_work",
    inboundId: created.inbound.id,
    sessionId: session.id,
    workbenchTaskId,
    project: candidate(resolved.project),
    resolution: resolved.resolution,
    deduped: created.deduped,
    queued: true,
    acknowledgement: await deliverGatewayResponse({
      inboundId: created.inbound.id,
      kind: "QUEUED_ACK",
      content: `Queued for ${resolved.project.name} Workbench. No task has been created yet.`,
      presentation: queuedPresentation({ projectName: resolved.project.name, inboundId: created.inbound.id }),
      dedupKey: `gateway-queued:${created.inbound.id}`,
    }, sender),
    workbench,
    instructions: `Tower already sent an idempotent native card saying the request is queued for the ${resolved.project.name} Workbench. Do not restate it and do not say a task was created yet. Tower will send a separate confirmation only after create_task succeeds, then a final result after Workbench review.`,
  };
  await saveRoute(created.inbound.id, result, "QUEUED");
  return result;
}

export async function completeGatewayInbound(inboundId: string, response: unknown): Promise<void> {
  await db.gatewayInbound.update({
    where: { id: inboundId },
    data: {
      state: "PROCESSED",
      response: JSON.stringify(response),
      processedAt: new Date(),
      lastError: null,
    },
  });
}

function retryAt(attempts: number, from = new Date()): Date {
  const delay = Math.min(DELIVERY_RETRY_MAX_MS, DELIVERY_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
  return new Date(from.getTime() + delay);
}

async function createOrGetDelivery(input: {
  dedupKey: string;
  sessionId: string;
  inboundId: string;
  kind: GatewayDeliveryKind;
  content: string;
  presentation?: GatewayMessagePresentation;
}) {
  try {
    return await db.gatewayDelivery.create({
      data: {
        ...input,
        presentation: input.presentation ? JSON.stringify(input.presentation) : null,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return db.gatewayDelivery.findUniqueOrThrow({ where: { dedupKey: input.dedupKey } });
  }
}

export async function deliverGatewayResponse(
  input: {
    inboundId: string;
    kind: GatewayDeliveryKind;
    content: string;
    presentation?: GatewayMessagePresentation;
    dedupKey: string;
  },
  sender: DeliverySender = sendViaHarnessGateway,
  claimAt = new Date(),
) {
  const inbound = await db.gatewayInbound.findUnique({
    where: { id: input.inboundId },
    include: { session: true },
  });
  if (!inbound?.session) throw new Error("Gateway inbound session not found");
  const delivery = await createOrGetDelivery({
    dedupKey: input.dedupKey,
    sessionId: inbound.session.id,
    inboundId: inbound.id,
    kind: input.kind,
    content: input.content,
    presentation: input.presentation,
  });
  if (delivery.state === "DELIVERED") return { ok: true, deduped: true, deliveryId: delivery.id };

  const claimed = await db.gatewayDelivery.updateMany({
    where: {
      id: delivery.id,
      OR: [
        { state: "PENDING" },
        { state: "FAILED", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: claimAt } }] },
      ],
    },
    data: { state: "SENDING", attempts: { increment: 1 }, lastError: null, nextAttemptAt: null },
  });
  if (claimed.count === 0) {
    const pending = await db.gatewayDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    if (pending.state === "DELIVERED") return { ok: true, deduped: true, deliveryId: delivery.id };
    return {
      ok: false,
      deduped: true,
      inProgress: pending.state === "SENDING",
      pendingRetry: pending.state === "FAILED",
      deliveryId: delivery.id,
      error: pending.lastError || "Gateway delivery is already in progress",
    };
  }
  const current = await db.gatewayDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  let sent: HarnessGatewaySendResult;
  try {
    sent = await sender({
      gateway: inbound.session.gateway,
      downstream: inbound.session.platform,
      dest: inbound.session.chatId,
      message: current.content,
      presentation: current.presentation ? JSON.parse(current.presentation) : undefined,
      scope: "work",
      replyToMessageId: inbound.platformMessageId,
      threadId: inbound.threadId,
    });
  } catch (error) {
    sent = { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
  if (!sent.ok) {
    const nextAttemptAt = retryAt(current.attempts, claimAt);
    await db.gatewayDelivery.update({
      where: { id: delivery.id },
      data: {
        state: "FAILED",
        lastError: sent.output.slice(0, 2000),
        nextAttemptAt,
      },
    });
    scheduleGatewayDeliveryRetry(nextAttemptAt, sender);
    return { ok: false, deliveryId: delivery.id, error: sent.output };
  }

  const metadata = parseGatewaySendOutput(sent.output);
  await db.gatewayDelivery.update({
    where: { id: delivery.id },
    data: {
      state: "DELIVERED",
      platformMessageId: metadata?.message_id ?? null,
      deliveredAt: new Date(),
      nextAttemptAt: null,
      lastError: null,
    },
  });
  return { ok: true, deduped: false, deliveryId: delivery.id, platformMessageId: metadata?.message_id ?? null };
}

export async function completeGatewayDiscussion(
  inboundId: string,
  response: string,
  sender: DeliverySender = sendViaHarnessGateway,
) {
  const canonical = await completeDiscussionTurn(inboundId, response);
  const inbound = await db.gatewayInbound.findUnique({
    where: { id: inboundId },
    select: { session: { select: { project: { select: { name: true } } } } },
  });
  if (!inbound?.session) throw new Error("Gateway discussion session not found");
  const result = await deliverGatewayResponse({
    inboundId,
    kind: "DISCUSSION_REPLY",
    content: canonical,
    presentation: discussionPresentation(inbound.session.project.name, canonical),
    dedupKey: `gateway-discussion:${inboundId}`,
  }, sender);
  if (result.ok) await completeGatewayInbound(inboundId, { mode: "project_discussion", delivered: true, response: canonical });
  return result;
}

export async function confirmGatewayTaskCreated(
  inboundId: string,
  taskId: string,
  reviewerTaskId?: string,
  sender: DeliverySender = sendViaHarnessGateway,
) {
  const inbound = await db.gatewayInbound.findUnique({
    where: { id: inboundId },
    include: { session: { include: { project: true } } },
  });
  if (!inbound?.session || inbound.intent !== "PROJECT_WORK") throw new Error("Gateway work request not found");
  const reviewer = reviewerTaskId?.trim() || process.env.TOWER_TASK_ID?.trim();
  if (!reviewer || reviewer !== inbound.session.workbenchTaskId) {
    throw new Error("Task creation must be confirmed by the bound project Workbench");
  }
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      status: true,
      baseBranch: true,
      projectId: true,
      project: { select: { name: true, workspace: { select: { name: true } } } },
      executions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, branch: true, worktreeBranch: true },
      },
    },
  });
  if (!task || task.projectId !== inbound.session.projectId) throw new Error("Created task does not belong to the gateway project");
  if (inbound.createdTaskId && inbound.createdTaskId !== task.id) {
    throw new Error("Gateway request already confirmed a different task");
  }
  await db.gatewayInbound.update({ where: { id: inboundId }, data: { createdTaskId: task.id } });
  const content = [
    `Task created: ${task.title}`,
    `Project: ${inbound.session.project.name}`,
    `Priority: ${task.priority}`,
    `Status: ${task.status}`,
    `Workspace: ${task.project.workspace.name}`,
    `Branch: ${task.executions[0]?.worktreeBranch || task.executions[0]?.branch || task.baseBranch || "none"}`,
    `Goal: ${extractTaskGoal(task.description)}`,
    `Auto-started: ${task.executions.length > 0 ? `yes (${task.executions[0]!.status})` : "no"}`,
    `Tower task: ${task.id}`,
  ].join("\n");
  const execution = task.executions[0];
  return deliverGatewayResponse({
    inboundId,
    kind: "TASK_CREATED",
    content,
    presentation: taskCreatedPresentation({
      taskId: task.id,
      title: task.title,
      projectName: task.project.name,
      priority: task.priority,
      status: task.status,
      workspaceName: task.project.workspace.name,
      branch: execution?.worktreeBranch || execution?.branch || task.baseBranch || "未创建分支",
      goal: extractTaskGoal(task.description),
      autoStarted: Boolean(execution),
      executionStatus: execution?.status,
    }),
    dedupKey: `gateway-task-created:${inboundId}:${task.id}`,
  }, sender);
}

function firstCommit(gitLog: string | null): { id: string; message: string } {
  const line = gitLog?.split("\n").find((item) => item.trim())?.trim() ?? "";
  const match = line.match(/^([0-9a-f]{7,40})\s+(.+)$/i);
  return match ? { id: match[1], message: match[2] } : { id: "none", message: "No commit recorded" };
}

export async function completeGatewayWork(input: {
  inboundId: string;
  taskId: string;
  resultSummary?: string;
  reviewerTaskId?: string;
}, sender: DeliverySender = sendViaHarnessGateway) {
  const inbound = await db.gatewayInbound.findUnique({
    where: { id: input.inboundId },
    include: { session: { include: { project: true } } },
  });
  if (!inbound?.session || inbound.intent !== "PROJECT_WORK") throw new Error("Gateway work request not found");
  const reviewerTaskId = input.reviewerTaskId?.trim() || process.env.TOWER_TASK_ID?.trim();
  if (!reviewerTaskId || reviewerTaskId !== inbound.session.workbenchTaskId) {
    throw new Error("Final gateway delivery must be approved by the bound project Workbench");
  }
  if (!inbound.createdTaskId) {
    throw new Error("Gateway task creation must be confirmed before final delivery");
  }
  if (inbound.createdTaskId !== input.taskId) {
    throw new Error("Task does not match the confirmed gateway work item");
  }
  const task = await db.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      title: true,
      status: true,
      projectId: true,
      executions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, summary: true, gitLog: true, branch: true, worktreeBranch: true, branchTipCommit: true, mergeCommit: true },
      },
    },
  });
  if (!task || task.projectId !== inbound.session.projectId) throw new Error("Reviewed task does not belong to the gateway project");
  if (task.status !== "DONE") throw new Error("Workbench must review and move the task to DONE before final delivery");
  const execution = task.executions[0];
  const commit = firstCommit(execution?.gitLog ?? null);
  const commitId = execution?.mergeCommit || execution?.branchTipCommit || commit.id;
  const branch = execution?.worktreeBranch || execution?.branch || "none";
  const summary = input.resultSummary?.trim() || execution?.summary?.trim() || "Completed and accepted by the project Workbench.";
  const content = [
    `Task completed: ${task.title}`,
    `Result: ${summary}`,
    `Commit: ${commitId} ${commit.message}`,
    `Branch: ${branch}`,
    `Tower task: ${task.id}`,
  ].join("\n");
  const result = await deliverGatewayResponse({
    inboundId: input.inboundId,
    kind: "FINAL_RESULT",
    content,
    presentation: finalResultPresentation({
      taskId: task.id,
      title: task.title,
      summary,
      commitId,
      commitMessage: commit.message,
      branch,
    }),
    dedupKey: `gateway-final:${input.inboundId}:${task.id}`,
  }, sender);
  if (result.ok) {
    await db.gatewayInbound.update({
      where: { id: input.inboundId },
      data: { state: "PROCESSED", processedAt: new Date(), response: content, lastError: null },
    });
  }
  return result;
}

export async function retryGatewayDeliveries(
  sender: DeliverySender = sendViaHarnessGateway,
  now = new Date(),
  limit = 50,
) {
  await db.gatewayDelivery.updateMany({
    where: {
      state: "SENDING",
      updatedAt: { lt: new Date(now.getTime() - 60_000) },
    },
    data: { state: "FAILED", nextAttemptAt: now, lastError: "Stale delivery claim recovered" },
  });
  const rows = await db.gatewayDelivery.findMany({
    where: {
      state: { in: ["PENDING", "FAILED"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let delivered = 0;
  let failed = 0;
  for (const row of rows) {
    if (!row.inboundId) continue;
    const result = await deliverGatewayResponse({
      inboundId: row.inboundId,
      kind: row.kind,
      content: row.content,
      dedupKey: row.dedupKey,
    }, sender, now);
    if (result.ok) {
      delivered++;
      if (row.kind === "DISCUSSION_REPLY" || row.kind === "FINAL_RESULT") {
        await db.gatewayInbound.update({
          where: { id: row.inboundId },
          data: { state: "PROCESSED", processedAt: new Date(), lastError: null },
        });
      }
    } else failed++;
  }
  const next = await db.gatewayDelivery.findFirst({
    where: {
      state: { in: ["PENDING", "FAILED"] },
      nextAttemptAt: { not: null },
    },
    orderBy: { nextAttemptAt: "asc" },
    select: { nextAttemptAt: true },
  });
  if (next?.nextAttemptAt) scheduleGatewayDeliveryRetry(next.nextAttemptAt, sender);
  return { scanned: rows.length, delivered, failed };
}

export async function recoverQueuedGatewayWork(
  ensureWorkbench: EnsureWorkbench = defaultEnsureWorkbench,
  limit = 100,
  sender: DeliverySender = sendViaHarnessGateway,
  restoreBoundary: (taskId: string) => boolean = restoreWorkbenchDrainBoundary,
) {
  const rows = await db.gatewayInbound.findMany({
    where: { intent: "PROJECT_WORK", state: { in: ["QUEUED", "PROCESSING"] }, sessionId: { not: null } },
    include: { session: { include: { project: { include: { workspace: { select: { name: true } } } } } } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let started = 0;
  let failed = 0;
  for (const inbound of rows) {
    const taskId = inbound.session?.workbenchTaskId;
    if (!taskId) continue;
    try {
      const queuedInput: GatewayInboundRequest = {
        gateway: inbound.gateway,
        platform: inbound.platform,
        chatId: inbound.chatId,
        platformMessageId: inbound.platformMessageId,
        senderId: inbound.senderId ?? undefined,
        threadId: inbound.threadId ?? undefined,
        rootMessageId: inbound.rootMessageId ?? undefined,
        replyToMessageId: inbound.replyToMessageId ?? undefined,
        intent: "PROJECT_WORK",
        content: inbound.content,
      };
      const project = inbound.session!.project;
      const gatewayProject: GatewayProject = {
        projectId: project.id,
        name: project.name,
        alias: project.alias,
        description: project.description,
        workspaceId: project.workspaceId,
        workspaceName: project.workspace.name,
      };
      const event = await enqueueWorkbenchEvent({
        parentTaskId: taskId,
        sourceTaskId: taskId,
        kind: "GATEWAY_WORK_REQUEST",
        priority: "NORMAL",
        dedupKey: `gateway-work:${inbound.id}`,
        payload: {
          childTaskId: taskId,
          childTitle: `${project.name} gateway request`,
          gatewayInboundId: inbound.id,
          gatewaySessionId: inbound.session!.id,
          gatewayMessage: workbenchPrompt(queuedInput, inbound.id, gatewayProject),
        },
      });
      if (event.event.state === "CONSUMED" && inbound.state === "QUEUED") {
        await db.gatewayInbound.update({ where: { id: inbound.id }, data: { state: "PROCESSING" } });
      }
      await deliverGatewayResponse({
        inboundId: inbound.id,
        kind: "QUEUED_ACK",
        content: `Queued for ${project.name} Workbench. No task has been created yet.`,
        presentation: queuedPresentation({ projectName: project.name, inboundId: inbound.id }),
        dedupKey: `gateway-queued:${inbound.id}`,
      }, sender);
      const resumed = await ensureWorkbench(taskId);
      if (resumed.mode !== "already_running") {
        // A server restart loses the process-local boundary set. A newly resumed
        // PTY starts at a safe empty-input boundary, so re-open it once here.
        openWorkbenchDrainBoundary(taskId);
      } else {
        // `already_running` can mean either an active turn or an idle TUI whose
        // process-local drain token was lost during a server/module restart.
        // Restore only when the live PTY retained an authoritative Stop signal.
        restoreBoundary(taskId);
      }
      started++;
      await db.gatewayInbound.update({ where: { id: inbound.id }, data: { lastError: null } });
    } catch (error) {
      failed++;
      await db.gatewayInbound.update({
        where: { id: inbound.id },
        data: { lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000) },
      });
    }
  }
  return { scanned: rows.length, started, failed };
}
