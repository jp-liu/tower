import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type {
  GatewayDeliveryKind,
  GatewayRequestKind,
  GatewaySessionKind,
  ProjectAccessMode,
  Prisma,
} from "@prisma/client";
import { continueOrStartTaskExecution } from "@/actions/agent-actions";
import { TOWER_LABEL_NAME } from "@/lib/constants";
import { db } from "@/lib/db";
import { readConfigValue } from "@/lib/config-reader";
import {
  decideGatewayChannelAccess,
  gatewayScopeAllowsProject,
  type GatewayChannelScope,
} from "@/lib/harness/gateway-channel-access";
import { ensureTowerTask } from "@/lib/instrumentation-tasks";
import { logger } from "@/lib/logger";
import { queryProjectKnowledge } from "@/lib/knowledge";
import { scoreProject } from "@/lib/project-score";
import { getSession } from "@/lib/pty/session-store";
import { getOpenAsk } from "@/lib/harness/harness-message";
import {
  activateWorkbenchCommandConsumer,
  publishWorkbenchCommand,
  restoreWorkbenchCommandConsumer,
} from "@/lib/workbench/command-inbox";
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

/** Legacy migration key; runtime authorization no longer reads this value. */
export const GATEWAY_CHANNEL_BINDINGS_KEY = "harness.channelBindings";
export const GATEWAY_RECENT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const INBOUND_CLAIM_LEASE_MS = 60_000;
const GATEWAY_RATE_WINDOW_MS = 60_000;
const GATEWAY_SENDER_RATE_LIMIT = 30;
const GATEWAY_CHAT_RATE_LIMIT = 120;
const GATEWAY_CHAT_QUEUE_LIMIT = 50;
const GATEWAY_GLOBAL_QUEUE_LIMIT = 500;
const GATEWAY_PROJECT_QUEUE_LIMIT = 100;
const WORKBENCH_ACTIVE_EVENT_LIMIT = 100;
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
}

export interface GatewayInboundRequest {
  gateway: string;
  platform: string;
  chatId: string;
  platformMessageId: string;
  senderId?: string;
  chatName?: string;
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

export interface GatewayTaskContextRequest {
  gateway: string;
  platform: string;
  chatId: string;
  replyToMessageId?: string;
  quotedText?: string;
  taskId?: string;
}

export interface GatewayBoundTaskContinuationRequest extends GatewayTaskContextRequest {
  platformMessageId: string;
  senderId?: string;
  content: string;
}

export type GatewayTaskBindingSource =
  | "harness_delivery"
  | "gateway_delivery"
  | "explicit_task"
  | "quoted_task_token"
  | "content_task_token";

export type GatewayTaskContextResult =
  | {
      bound: false;
      reason: "not_found" | "not_allowed";
    }
  | {
      bound: true;
      bindingSource: GatewayTaskBindingSource;
      subjectTaskId: string;
      producerTaskId: string;
      workbenchTaskId: string | null;
      parentTaskId: string | null;
      taskTitle: string;
      taskStatus: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED";
      hasOpenAsk: boolean;
      project: GatewayProjectCandidate;
      latestExecution: {
        executionId: string;
        status: "PENDING" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED";
        summary: string | null;
        startedAt: Date | null;
        endedAt: Date | null;
      } | null;
    };

export type GatewayBoundTaskContinuationResult =
  | {
      mode: "continued_task";
      inboundId: string;
      taskId: string;
      executionId: string | null;
      executionMode: "already_running" | "continued" | "started";
      injected: true;
      deduped: boolean;
      noOp?: boolean;
    }
  | {
      mode: "continue_in_progress" | "continue_failed" | "continue_not_bound" | "continue_open_ask" | "continue_conflict";
      inboundId: string;
      deduped: boolean;
      noOp: boolean;
      taskId?: string;
      reason?: string;
    };

export type BoundTaskContinuationExecutor = (
  taskId: string,
  text: string,
  idempotencyKey: string,
) => Promise<{
  executionId: string | null;
  executionMode: "already_running" | "continued" | "started";
  injected: true;
}>;

export interface GatewayProjectCandidate {
  projectId: string;
  name: string;
  alias: string | null;
  workspaceId: string;
  workspaceName: string;
}

type GatewayProject = GatewayProjectCandidate & {
  description: string | null;
  accessMode: ProjectAccessMode;
  groupId?: string | null;
  groupName?: string | null;
};

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
      mode: "task_context";
      inboundId: string;
      taskId: string;
      project: GatewayProjectCandidate;
      resolution: "reply_binding";
      deduped: boolean;
      context: Extract<GatewayTaskContextResult, { bound: true }>;
      instructions: string;
    }
  | {
      mode: "tower_mcp";
      inboundId: string;
      deduped: boolean;
      instructions: string;
    }
  | {
      mode: "direct_not_supported";
      inboundId: null;
      deduped: false;
      noOp: true;
      instructions: string;
    }
  | {
      mode: "channel_access_denied";
      inboundId: string;
      deduped: boolean;
      noOp: true;
      silent: boolean;
      reason: "CHANNEL_UNAUTHORIZED" | "CHANNEL_REVOKED" | "SCOPE_INVALID";
      instructions: string;
    }
  | {
      mode: "rate_limited";
      inboundId: string;
      deduped: boolean;
      scope: "sender" | "chat" | "queue" | "global" | "project" | "workbench";
      retryAfterSeconds: number;
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
  return normalize(value).replace(/^(?:feishu|lark|wechat|weixin):/, "").replace(/^chat:/, "");
}

function matchesHarnessDeliveryChannel(input: {
  platform: string;
  chatId: string;
}, delivery: {
  platform: string;
  chatId: string;
}): boolean {
  if (normalize(delivery.platform) !== normalize(input.platform)) return false;

  const deliveryChatId = normalizeChatId(delivery.chatId);
  const inboundChatId = normalizeChatId(input.chatId);
  if (deliveryChatId === inboundChatId) return true;

  // OpenClaw identifies a Feishu P2P inbound by the user's open_id (`user:ou_*`),
  // while the send receipt identifies that same conversation by its chat_id
  // (`feishu:oc_*`). The platform message id is globally unique and already has
  // a unique DB index, so allow only this provider-specific direct-chat alias
  // pair. Group-to-group (`oc_*` vs `oc_*`) mismatches still fail closed.
  const platform = normalize(input.platform);
  if (platform !== "feishu" && platform !== "lark") return false;
  const deliveryId = deliveryChatId.replace(/^user:/, "");
  const inboundId = inboundChatId.replace(/^user:/, "");
  return (
    (deliveryId.startsWith("oc_") && inboundId.startsWith("ou_"))
    || (deliveryId.startsWith("ou_") && inboundId.startsWith("oc_"))
  );
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
    include: {
      workspace: { select: { id: true, name: true } },
      group: { select: { id: true, name: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
  });
  return rows.map((project) => ({
    projectId: project.id,
    name: project.name,
    alias: project.alias,
    description: project.description,
    accessMode: project.accessMode,
    groupId: project.groupId,
    groupName: project.group?.name ?? null,
    workspaceId: project.workspaceId,
    workspaceName: project.workspace.name,
  }));
}

function bindingForScope(scope: GatewayChannelScope): GatewayChannelBinding | null {
  if (scope.mode === "ALL") return null;
  if (scope.mode === "WORKSPACE") {
    return { platform: "", chatId: "", defaultWorkspaceId: scope.workspaceId };
  }
  return { platform: "", chatId: "", allowedProjectIds: scope.projectIds };
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
          accessMode: true,
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
      accessMode: task.project.accessMode,
      workspaceId: task.project.workspaceId,
      workspaceName: task.project.workspace.name,
    },
  };
}

type TaskBindingReference = {
  taskId: string;
  bindingSource: GatewayTaskBindingSource;
  producerTaskId?: string | null;
  workbenchTaskId?: string | null;
};

async function resolveTaskBindingReference(
  input: GatewayTaskContextRequest & { content?: string },
): Promise<TaskBindingReference | null> {
  if (input.replyToMessageId?.trim()) {
    const harness = await findHarnessDeliveryByPlatformMessageId(input.replyToMessageId);
    if (
      harness
      && matchesHarnessDeliveryChannel(input, harness)
    ) {
      return {
        taskId: harness.taskId,
        bindingSource: "harness_delivery",
        producerTaskId: harness.taskId,
      };
    }

    const gatewayDelivery = await db.gatewayDelivery.findFirst({
      where: {
        platformMessageId: input.replyToMessageId.trim(),
        state: "DELIVERED",
        session: {
          gateway: normalize(input.gateway),
          platform: normalize(input.platform),
          chatId: normalizeChatId(input.chatId),
        },
      },
      orderBy: { deliveredAt: "desc" },
      select: {
        session: { select: { workbenchTaskId: true } },
        inbound: { select: { createdTaskId: true } },
      },
    });
    if (gatewayDelivery?.inbound?.createdTaskId) {
      return {
        taskId: gatewayDelivery.inbound.createdTaskId,
        bindingSource: "gateway_delivery",
        producerTaskId: gatewayDelivery.session.workbenchTaskId,
        workbenchTaskId: gatewayDelivery.session.workbenchTaskId,
      };
    }
  }

  const explicitTaskId = input.taskId?.trim();
  if (explicitTaskId) return { taskId: explicitTaskId, bindingSource: "explicit_task" };
  const quotedTaskId = extractTowerTaskId(input.quotedText);
  if (quotedTaskId) return { taskId: quotedTaskId, bindingSource: "quoted_task_token" };
  const contentTaskId = extractTowerTaskId(input.content);
  return contentTaskId ? { taskId: contentTaskId, bindingSource: "content_task_token" } : null;
}

export async function resolveGatewayTaskContext(
  input: GatewayTaskContextRequest & { content?: string },
): Promise<GatewayTaskContextResult> {
  const reference = await resolveTaskBindingReference(input);
  if (!reference) return { bound: false, reason: "not_found" };

  const task = await db.task.findUnique({
    where: { id: reference.taskId },
    select: {
      id: true,
      title: true,
      status: true,
      parentTaskId: true,
      projectId: true,
      project: {
        select: {
          id: true,
          name: true,
          alias: true,
          workspaceId: true,
          workspace: { select: { name: true } },
        },
      },
      executions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          summary: true,
          startedAt: true,
          endedAt: true,
        },
      },
    },
  });
  if (!task) return { bound: false, reason: "not_found" };

  const parentIsWorkbench = task.parentTaskId
    ? await db.task.findFirst({
        where: {
          id: task.parentTaskId,
          labels: { some: { label: { isBuiltin: true, name: TOWER_LABEL_NAME } } },
        },
        select: { id: true },
      })
    : null;
  const openAsk = await getOpenAsk(task.id);
  const latestExecution = task.executions[0] ?? null;
  const workbenchTaskId = reference.workbenchTaskId ?? parentIsWorkbench?.id ?? null;
  const producerTaskId = reference.producerTaskId ?? task.parentTaskId ?? task.id;

  return {
    bound: true,
    bindingSource: reference.bindingSource,
    subjectTaskId: task.id,
    producerTaskId,
    workbenchTaskId,
    parentTaskId: task.parentTaskId,
    taskTitle: task.title,
    taskStatus: task.status,
    hasOpenAsk: !!openAsk,
    project: {
      projectId: task.project.id,
      name: task.project.name,
      alias: task.project.alias,
      workspaceId: task.project.workspaceId,
      workspaceName: task.project.workspace.name,
    },
    latestExecution: latestExecution
      ? {
          executionId: latestExecution.id,
          status: latestExecution.status,
          summary: latestExecution.summary,
          startedAt: latestExecution.startedAt,
          endedAt: latestExecution.endedAt,
        }
      : null,
  };
}

async function resolveTaskBinding(input: GatewayInboundRequest) {
  const reference = await resolveTaskBindingReference(input);
  return reference ? taskProject(reference.taskId) : null;
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
  options: {
    ignoreSessionBindings?: boolean;
    enforceProjectScope?: boolean;
  } = {},
): Promise<
  | { project: GatewayProject; resolution: string }
  | { candidates: GatewayProjectCandidate[]; reason: "ambiguous" | "not_found" | "not_allowed" }
> {
  const scopeBinding = options.enforceProjectScope === false ? null : binding;
  if (!options.ignoreSessionBindings && input.replyToMessageId?.trim()) {
    const delivery = await db.gatewayDelivery.findFirst({
      where: { platformMessageId: input.replyToMessageId.trim(), state: "DELIVERED" },
      orderBy: { deliveredAt: "desc" },
      include: { session: { include: { project: { include: { workspace: { select: { name: true } } } } } } },
    });
    if (delivery?.session) {
      const project = delivery.session.project;
      if (!projectAllowed(project.id, scopeBinding, project.workspaceId)) {
        return { candidates: [], reason: "not_allowed" };
      }
      return {
        project: {
          projectId: project.id,
          name: project.name,
          alias: project.alias,
          description: project.description,
          accessMode: project.accessMode,
          workspaceId: project.workspaceId,
          workspaceName: project.workspace.name,
        },
        resolution: "reply_message_binding",
      };
    }
  }

  const boundSession = options.ignoreSessionBindings ? null : await resolveBoundSession(input);
  if (boundSession) {
    if (!projectAllowed(
      boundSession.projectId,
      scopeBinding,
      boundSession.project.workspaceId,
    )) {
      return { candidates: [], reason: "not_allowed" };
    }
    return {
      project: {
        projectId: boundSession.project.id,
        name: boundSession.project.name,
        alias: boundSession.project.alias,
        description: boundSession.project.description,
        accessMode: boundSession.project.accessMode,
        workspaceId: boundSession.project.workspaceId,
        workspaceName: boundSession.project.workspace.name,
      },
      resolution: "thread_session_binding",
    };
  }

  const scope: Prisma.ProjectWhereInput = {
    ...(scopeBinding?.defaultWorkspaceId ? { workspaceId: scopeBinding.defaultWorkspaceId } : {}),
    ...(scopeBinding?.allowedProjectIds?.length ? { id: { in: scopeBinding.allowedProjectIds } } : {}),
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
    const matchedGroupIds = new Set(identified.map((item) => item.project.groupId).filter(Boolean));
    if (
      input.intent === "PROJECT_DISCUSSION"
      && identified.length > 1
      && matchedGroupIds.size === 1
      && identified.every((item) => item.project.groupId)
    ) {
      const anchor = identified.find((item) => item.project.name.endsWith("-trace")) ?? identified[0];
      return { project: anchor.project, resolution: "identify_product_group" };
    }
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
        ...(scopeBinding?.defaultWorkspaceId ? { project: { workspaceId: scopeBinding.defaultWorkspaceId } } : {}),
        ...(scopeBinding?.allowedProjectIds?.length ? { projectId: { in: scopeBinding.allowedProjectIds } } : {}),
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
          accessMode: recent.project.accessMode,
          workspaceId: recent.project.workspaceId,
          workspaceName: recent.project.workspace.name,
        },
        resolution: "recent_user_project",
      };
    }
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

function continuationInbound(input: GatewayBoundTaskContinuationRequest): GatewayInboundRequest {
  return {
    gateway: input.gateway,
    platform: input.platform,
    chatId: input.chatId,
    platformMessageId: input.platformMessageId,
    senderId: input.senderId,
    replyToMessageId: input.replyToMessageId,
    quotedText: input.quotedText,
    taskId: input.taskId,
    intent: "PROJECT_WORK",
    content: input.content,
  };
}

function parseContinuationResult(response: string | null): GatewayBoundTaskContinuationResult | null {
  if (!response) return null;
  try {
    const parsed = JSON.parse(response) as { mode?: string };
    return parsed.mode === "continued_task"
      || parsed.mode === "continue_in_progress"
      || parsed.mode === "continue_failed"
      || parsed.mode === "continue_not_bound"
      || parsed.mode === "continue_open_ask"
      || parsed.mode === "continue_conflict"
      ? parsed as GatewayBoundTaskContinuationResult
      : null;
  } catch {
    return null;
  }
}

function parseTaskContextResult(
  response: string | null,
): Extract<GatewayRouteResult, { mode: "task_context" }> | null {
  if (!response) return null;
  try {
    const parsed = JSON.parse(response) as GatewayRouteResult;
    return parsed.mode === "task_context" ? parsed : null;
  } catch {
    return null;
  }
}

function continuationConflict(inboundId: string, reason: string): GatewayBoundTaskContinuationResult {
  return {
    mode: "continue_conflict",
    inboundId,
    deduped: true,
    noOp: true,
    reason,
  };
}

function continuationPrompt(
  input: GatewayBoundTaskContinuationRequest,
  context: Extract<GatewayTaskContextResult, { bound: true }>,
  inboundId: string,
): string {
  return [
    "[Explicit Gateway Task Continuation]",
    `Gateway inbound ID: ${inboundId}`,
    `Task: ${context.taskTitle}`,
    `Task ID: [[tower:task=${context.subjectTaskId}]]`,
    `Source: ${input.platform}:${input.chatId}`,
    `Platform message ID: ${input.platformMessageId}`,
    input.replyToMessageId ? `Reply-to message ID: ${input.replyToMessageId}` : null,
    "",
    input.content.trim(),
    "",
    "The OWNER explicitly chose to continue this Tower development task. Continue only this task from its existing context. Do not treat the message as a status query or external-operator request.",
  ].filter((line) => line !== null).join("\n");
}

export async function continueGatewayBoundTask(
  input: GatewayBoundTaskContinuationRequest,
  executor: BoundTaskContinuationExecutor,
): Promise<GatewayBoundTaskContinuationResult> {
  const created = await createInbound(continuationInbound(input));
  const existingResponse = created.inbound.response;
  const cached = parseContinuationResult(existingResponse);
  const routed = parseTaskContextResult(existingResponse);
  let expectedTaskId: string | null = null;

  if (created.deduped) {
    if (cached?.mode === "continued_task") {
      return { ...cached, deduped: true, noOp: true };
    }
    if (cached && cached.mode !== "continue_failed" && cached.mode !== "continue_in_progress") {
      return { ...cached, deduped: true, noOp: true };
    }
    const stale = Date.now() - created.inbound.updatedAt.getTime() >= INBOUND_CLAIM_LEASE_MS;
    const retryable = cached?.mode === "continue_failed"
      || (cached?.mode === "continue_in_progress" && stale)
      || (!existingResponse && stale)
      || !!routed;
    if (!retryable) {
      return {
        mode: created.inbound.state === "FAILED" ? "continue_failed" : "continue_in_progress",
        inboundId: created.inbound.id,
        deduped: true,
        noOp: true,
        taskId: cached?.taskId,
        reason: created.inbound.lastError ?? undefined,
      };
    }
    if (created.inbound.content.trim() !== input.content.trim()) {
      return continuationConflict(
        created.inbound.id,
        "The platform message content does not match the persisted Tower inbound.",
      );
    }
    expectedTaskId = routed?.context.subjectTaskId ?? cached?.taskId ?? null;
    if (existingResponse && !routed && !cached) {
      return continuationConflict(
        created.inbound.id,
        "This platform message was already processed by another Tower gateway action.",
      );
    }
  }

  const context = await resolveGatewayTaskContext(input);
  if (context.bound && expectedTaskId && context.subjectTaskId !== expectedTaskId) {
    return continuationConflict(
      created.inbound.id,
      "The requested task does not match the task context persisted for this platform message.",
    );
  }

  const inProgress: GatewayBoundTaskContinuationResult = {
    mode: "continue_in_progress",
    inboundId: created.inbound.id,
    taskId: context.bound ? context.subjectTaskId : expectedTaskId ?? undefined,
    deduped: created.deduped,
    noOp: false,
  };
  if (created.deduped) {
    const claimed = await db.gatewayInbound.updateMany({
      where: {
        id: created.inbound.id,
        state: created.inbound.state,
        response: existingResponse,
        updatedAt: created.inbound.updatedAt,
      },
      data: {
        state: "PROCESSING",
        response: JSON.stringify(inProgress),
        processedAt: null,
        lastError: null,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) {
      const current = await db.gatewayInbound.findUniqueOrThrow({ where: { id: created.inbound.id } });
      const currentResult = parseContinuationResult(current.response);
      if (currentResult) return { ...currentResult, deduped: true, noOp: true };
      return {
        mode: "continue_in_progress",
        inboundId: current.id,
        taskId: context.bound ? context.subjectTaskId : expectedTaskId ?? undefined,
        deduped: true,
        noOp: true,
      };
    }
  } else {
    await db.gatewayInbound.update({
      where: { id: created.inbound.id },
      data: {
        state: "PROCESSING",
        response: JSON.stringify(inProgress),
        lastError: null,
        attempts: { increment: 1 },
      },
    });
  }

  if (!context.bound) {
    const result: GatewayBoundTaskContinuationResult = {
      mode: "continue_not_bound",
      inboundId: created.inbound.id,
      deduped: created.deduped,
      noOp: true,
      reason: context.reason,
    };
    await completeGatewayInbound(created.inbound.id, result);
    return result;
  }
  if (context.hasOpenAsk) {
    const result: GatewayBoundTaskContinuationResult = {
      mode: "continue_open_ask",
      inboundId: created.inbound.id,
      taskId: context.subjectTaskId,
      deduped: created.deduped,
      noOp: true,
      reason: "The task has an open ask_human question; answer it with reply_to_ask instead of continuing the task.",
    };
    await completeGatewayInbound(created.inbound.id, result);
    return result;
  }

  try {
    const executed = await executor(
      context.subjectTaskId,
      continuationPrompt(input, context, created.inbound.id),
      created.inbound.id,
    );
    const result: GatewayBoundTaskContinuationResult = {
      mode: "continued_task",
      inboundId: created.inbound.id,
      taskId: context.subjectTaskId,
      executionId: executed.executionId,
      executionMode: executed.executionMode,
      injected: true,
      deduped: created.deduped,
    };
    await completeGatewayInbound(created.inbound.id, result);
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const result: GatewayBoundTaskContinuationResult = {
      mode: "continue_failed",
      inboundId: created.inbound.id,
      taskId: context.subjectTaskId,
      deduped: created.deduped,
      noOp: false,
      reason,
    };
    await db.gatewayInbound.update({
      where: { id: created.inbound.id },
      data: { state: "FAILED", response: JSON.stringify(result), lastError: reason },
    });
    return result;
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
            origin: "GATEWAY",
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

async function requeueAbandonedWorkbenchEvent(input: {
  eventId: string;
  parentTaskId: string;
  reason: string;
  atTurnBoundary?: boolean;
}): Promise<boolean> {
  const live = getSession(input.parentTaskId);
  if (live && !live.killed && !input.atTurnBoundary) return false;
  if (!input.atTurnBoundary) {
    const running = await db.taskExecution.count({
      where: { taskId: input.parentTaskId, status: "RUNNING" },
    });
    if (running > 0) return false;
  }
  const reset = await db.workbenchEvent.updateMany({
    where: { id: input.eventId, state: "CONSUMED" },
    data: {
      state: "PENDING",
      claimToken: null,
      claimedAt: null,
      consumedAt: null,
      batchId: null,
      lastError: input.reason.slice(0, 2000),
    },
  });
  return reset.count > 0;
}

function workbenchPrompt(input: GatewayInboundRequest, inboundId: string, project: GatewayProject): string {
  return [
    "[Gateway project work request]",
    `Project: ${project.name} (id: ${project.projectId})`,
    `Gateway inbound ID: ${inboundId}`,
    `Source: ${input.platform}:${input.chatId}`,
    `Repository safety mode: ${project.accessMode}`,
    input.threadId ? `Thread: ${input.threadId}` : null,
    input.rootMessageId ? `Root message: ${input.rootMessageId}` : null,
    "",
    input.content.trim(),
    "",
    project.accessMode === "REVIEW_ONLY"
      ? "This project is REVIEW_ONLY. You may inspect, discuss, and produce a review report, but must not dispatch file modifications, dependency installation, repository scripts, commits, or other write work. Ask the owner to upgrade the project to FULL_WORK before any mutation."
      : null,
    `Handle this as the resident project Workbench. Research and dispatch through create_task; do not implement the work in the Workbench terminal. Pass gatewayInboundId=${inboundId} to create_task so a crash after creation can recover the same task. Only after create_task returns a real task id, call confirm_gateway_task_created with this inbound id and that task id. After the child result is reviewed and accepted, call complete_gateway_work with the same inbound id, the task id, and the reviewed result summary. Those tools own idempotent replies to the original external thread.`,
  ].filter((line) => line !== null).join("\n");
}

export async function routeGatewayInbound(
  input: GatewayInboundRequest,
  ensureWorkbench: EnsureWorkbench = defaultEnsureWorkbench,
  sender: DeliverySender = sendViaHarnessGateway,
  options: { projectQueryOnly?: boolean } = {},
): Promise<GatewayRouteResult> {
  if (input.intent === "DIRECT") {
    return {
      mode: "direct_not_supported",
      inboundId: null,
      deduped: false,
      noOp: true,
      instructions:
        "DIRECT requests are outside Tower's routing boundary. Answer or delegate in the gateway without calling Tower.",
    };
  }
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

  let binding: GatewayChannelBinding | null = null;
  if (options.projectQueryOnly) {
    const decision = await decideGatewayChannelAccess(input);
    if (!decision.allowed) {
      const recentInbounds = await db.gatewayInbound.count({
        where: {
          gateway: normalize(input.gateway),
          platform: normalize(input.platform),
          chatId: normalizeChatId(input.chatId),
          createdAt: { gte: new Date(Date.now() - GATEWAY_RATE_WINDOW_MS) },
        },
      });
      const silent = recentInbounds > 1;
      const result: GatewayRouteResult = {
        mode: "channel_access_denied",
        inboundId: created.inbound.id,
        deduped: created.deduped,
        noOp: true,
        silent,
        reason: decision.reason,
        instructions: silent
          ? "Return NO_REPLY. This channel's deterministic authorization denial is rate-limited. Do not call another Tower tool."
          : decision.reason === "SCOPE_INVALID"
            ? "本群的 Tower 授权范围已失效，请联系 OWNER 重新绑定工作区或项目。不要调用其他 Tower 工具。"
            : "本群尚未获得 Tower OWNER 授权，暂时无法使用。请联系 OWNER 在本群发送“@Tower 授权本群”或直接绑定工作区/项目。不要调用其他 Tower 工具。",
      };
      await saveRoute(created.inbound.id, result, "PROCESSED");
      return result;
    }
    binding = bindingForScope(decision.scope);
  }

  const rateWindowStart = new Date(Date.now() - GATEWAY_RATE_WINDOW_MS);
  const [senderCount, chatCount, queuedCount, globalQueuedCount] = await Promise.all([
    input.senderId
      ? db.gatewayInbound.count({
          where: {
            platform: input.platform,
            chatId: input.chatId,
            senderId: input.senderId,
            createdAt: { gte: rateWindowStart },
          },
        })
      : Promise.resolve(0),
    db.gatewayInbound.count({
      where: {
        platform: input.platform,
        chatId: input.chatId,
        createdAt: { gte: rateWindowStart },
      },
    }),
    db.gatewayInbound.count({
      where: {
        platform: input.platform,
        chatId: input.chatId,
        state: "QUEUED",
      },
    }),
    db.gatewayInbound.count({ where: { state: "QUEUED" } }),
  ]);
  const limitedScope: "sender" | "chat" | "queue" | "global" | null =
    globalQueuedCount >= GATEWAY_GLOBAL_QUEUE_LIMIT
      ? "global"
      : queuedCount >= GATEWAY_CHAT_QUEUE_LIMIT
      ? "queue"
      : senderCount > GATEWAY_SENDER_RATE_LIMIT
        ? "sender"
        : chatCount > GATEWAY_CHAT_RATE_LIMIT
          ? "chat"
          : null;
  if (limitedScope) {
    const result: GatewayRouteResult = {
      mode: "rate_limited",
      inboundId: created.inbound.id,
      deduped: false,
      scope: limitedScope,
      retryAfterSeconds: limitedScope === "queue" || limitedScope === "global" ? 120 : 60,
      instructions: limitedScope === "queue" || limitedScope === "global"
        ? "This trusted channel already has too many queued Workbench requests. Do not create or retry work now; ask the OWNER to wait or diagnose the backlog."
        : "The sender or trusted channel exceeded the Tower gateway rate limit. Do not call other Tower tools for this message; ask the user to retry after the reported delay.",
    };
    await saveRoute(created.inbound.id, result, "PROCESSED");
    return result;
  }

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

  const reply = options.projectQueryOnly || explicitlyStartsNewWork(input) || input.sessionAction === "NEW"
    ? null
    : await resolveTaskBinding(input);
  if (reply) {
    if (!projectAllowed(
      reply.project.projectId,
      options.projectQueryOnly ? binding : null,
      reply.project.workspaceId,
    )) {
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
    const context = await resolveGatewayTaskContext(input);
    if (!context.bound) {
      const denied: GatewayRouteResult = {
        mode: "needs_project_selection",
        inboundId: created.inbound.id,
        deduped: created.deduped,
        candidates: [],
        reason: context.reason === "not_allowed" ? "not_allowed" : "not_found",
      };
      await saveRoute(created.inbound.id, denied, "PROCESSED");
      return denied;
    }
    const result: GatewayRouteResult = {
      mode: "task_context",
      inboundId: created.inbound.id,
      taskId: reply.taskId,
      project: candidate(reply.project),
      resolution: "reply_binding",
      deduped: created.deduped,
      context,
      instructions:
        "Task binding resolved without side effects. Query with read-only Tower tools, answer an open ask with reply_to_ask, or explicitly continue development with continue_bound_task.",
    };
    await saveRoute(created.inbound.id, result, "PROCESSED");
    return result;
  }

  if (input.intent === "TOWER") {
    const result: GatewayRouteResult = {
      mode: "tower_mcp",
      inboundId: created.inbound.id,
      deduped: created.deduped,
      instructions: `Handle only read-only Tower queries with the gateway's exposed query tools. If the OWNER asked to authorize, bind, unbind, revoke, or inspect this group, call manage_gateway_channel_access with gatewayInboundId=${created.inbound.id}; never ask for chatId or senderId. Other mutations must be classified as PROJECT_WORK before routing so the resident Workbench exclusively owns task creation, execution, review, and callbacks; the ingress agent intentionally has no direct mutation tools.`,
    };
    await saveRoute(created.inbound.id, result, "PROCESSED");
    return result;
  }

  const resolved = await resolveProject(input, binding, {
    ignoreSessionBindings: input.sessionAction === "NEW",
    // Channel scopes are a hard boundary for NON_OWNER queries. The OWNER
    // route still uses the binding for default-project hints, but searches all
    // registered Tower projects.
    enforceProjectScope: Boolean(options.projectQueryOnly),
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

  if (input.intent === "PROJECT_DISCUSSION" || resolved.project.accessMode === "REVIEW_ONLY") {
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
      instructions: [
        `You are discussing the ${resolved.project.name} project with Tower-owned history.`,
        resolved.project.accessMode === "REVIEW_ONLY"
          ? "This project is REVIEW_ONLY: answer from read-only project context and produce review findings in the discussion; no task or terminal execution may be created until the owner explicitly changes it to FULL_WORK."
          : null,
        `Use projectId=${resolved.project.projectId} for ask_project_knowledge and other scoped Tower tools. Use the returned history messages as recent context${history.truncated ? "; earlier turns were truncated" : ""}. Do not answer as an unbound general Tower assistant. Prepare the project-aware response, then call complete_gateway_discussion with inboundId=${created.inbound.id}; that tool persists the assistant turn, sends one idempotent native card replying to the current inbound message, and releases this turn's execution resources.`,
      ].filter(Boolean).join(" "),
    };
    await db.gatewayInbound.update({ where: { id: created.inbound.id }, data: { sessionId: session.id } });
    await saveRoute(created.inbound.id, result, "PROCESSING");
    return result;
  }

  const workbenchTaskId = await ensureTowerTask(resolved.project.projectId, resolved.project.name);
  const session = await ensureSession(input, "WORKBENCH", resolved.project, workbenchTaskId);
  const admission = await db.$transaction(async (tx) => {
    const [projectQueued, workbenchEvents, globalQueued] = await Promise.all([
      tx.gatewayInbound.count({
        where: {
          state: "QUEUED",
          session: { projectId: resolved.project.projectId },
        },
      }),
      tx.workbenchEvent.count({
        where: {
          parentTaskId: workbenchTaskId,
          state: { in: ["PENDING", "PROCESSING"] },
        },
      }),
      tx.gatewayInbound.count({ where: { state: "QUEUED" } }),
    ]);
    const scope: "global" | "project" | "workbench" | null =
      globalQueued >= GATEWAY_GLOBAL_QUEUE_LIMIT
        ? "global"
        : projectQueued >= GATEWAY_PROJECT_QUEUE_LIMIT
          ? "project"
          : workbenchEvents >= WORKBENCH_ACTIVE_EVENT_LIMIT
            ? "workbench"
            : null;
    if (!scope) {
      await tx.gatewayInbound.update({
        where: { id: created.inbound.id },
        data: { sessionId: session.id, state: "QUEUED" },
      });
    }
    return { scope, projectQueued, workbenchEvents, globalQueued };
  });
  if (admission.scope) {
    const result: GatewayRouteResult = {
      mode: "rate_limited",
      inboundId: created.inbound.id,
      deduped: false,
      scope: admission.scope,
      retryAfterSeconds: 120,
      instructions:
        `Tower admission control rejected this request at the ${admission.scope} quota ` +
        `(projectQueued=${admission.projectQueued}, workbenchEvents=${admission.workbenchEvents}, ` +
        `globalQueued=${admission.globalQueued}). Ask the OWNER to wait or diagnose the backlog.`,
    };
    await saveRoute(created.inbound.id, result, "PROCESSED");
    return result;
  }
  await publishWorkbenchCommand({
    parentTaskId: workbenchTaskId,
    sourceTaskId: workbenchTaskId,
    kind: "GATEWAY_WORK_REQUEST",
    priority: "NORMAL",
    dedupKey: `gateway-work:${created.inbound.id}`,
    payload: {
      childTaskId: workbenchTaskId,
      childTitle: `${resolved.project.name} gateway request`,
      instruction: workbenchPrompt(input, created.inbound.id, resolved.project),
      sourceReference: { namespace: "gateway_inbound", id: created.inbound.id },
    },
  });

  let workbench: { mode: string; executionId: string | null } | { error: string };
  try {
    workbench = await ensureWorkbench(workbenchTaskId);
    activateWorkbenchCommandConsumer(workbenchTaskId, workbench.mode);
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

/**
 * Capability-scoped routing surface for non-owner gateway users.
 *
 * OpenClaw decides whether the sender may see this tool. Tower deliberately
 * does not identify the owner here; it only guarantees that this capability
 * can create a project discussion and can never relay task replies or enqueue
 * project work.
 */
export async function routeGatewayProjectQuery(
  input: Omit<GatewayInboundRequest, "intent" | "taskId" | "startNewWork">,
): Promise<GatewayRouteResult> {
  return routeGatewayInbound(
    {
      ...input,
      intent: "PROJECT_DISCUSSION",
      taskId: undefined,
      startNewWork: false,
    },
    defaultEnsureWorkbench,
    sendViaHarnessGateway,
    { projectQueryOnly: true },
  );
}

export async function readGatewayProjectContext(inboundId: string, question: string) {
  const inbound = await db.gatewayInbound.findUnique({
    where: { id: inboundId },
    select: {
      id: true,
      intent: true,
      gateway: true,
      platform: true,
      chatId: true,
      senderId: true,
      session: {
        select: {
          kind: true,
          project: {
            select: {
              id: true,
              name: true,
              alias: true,
              groupId: true,
              workspace: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
  if (!inbound?.session || inbound.session.kind !== "DISCUSSION") {
    throw new Error("Gateway inbound is not bound to a project discussion");
  }
  const project = inbound.session.project;
  const decision = await decideGatewayChannelAccess(inbound);
  if (!decision.allowed || !gatewayScopeAllowsProject(decision.scope, {
    id: project.id,
    workspaceId: project.workspace.id,
  })) {
    throw new Error("Gateway channel is not authorized to read this project");
  }
  const groupedProjects = project.groupId
    ? await db.project.findMany({
        where: { groupId: project.groupId },
        select: { id: true, workspaceId: true },
      })
    : [];
  if (project.groupId && groupedProjects.some((item) =>
    !gatewayScopeAllowsProject(decision.scope, item)
  )) {
    throw new Error("Gateway channel is not authorized to read every project in this product group");
  }
  const [knowledge, tasks] = await Promise.all([
    queryProjectKnowledge(db, project.id, question.trim()),
    db.task.findMany({
      where: { projectId: project.id },
      orderBy: [{ updatedAt: "desc" }],
      take: 50,
      select: {
        title: true,
        status: true,
        priority: true,
        updatedAt: true,
      },
    }),
  ]);
  return {
    inboundId: inbound.id,
    project: {
      projectId: project.id,
      name: project.name,
      alias: project.alias,
      workspaceId: project.workspace.id,
      workspaceName: project.workspace.name,
    },
    question: question.trim(),
    tasks,
    knowledge: {
      query: knowledge.query,
      projects: knowledge.projects.map(({ projectId, name, groupId, knowledgeDir }) => ({
        projectId,
        name,
        groupId,
        knowledgeDir,
      })),
      facts: knowledge.facts,
      versions: knowledge.versions,
      knowledgeFiles: knowledge.knowledgeFiles,
      indexes: knowledge.indexes,
      notes: knowledge.notes,
      warnings: knowledge.warnings,
    },
  };
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
  if (delivery.state === "SENT_UNVERIFIED") {
    return {
      ok: false,
      deduped: true,
      sent: true,
      requiresManualReview: true,
      deliveryId: delivery.id,
      platformMessageId: delivery.platformMessageId,
      error: delivery.lastError || "Platform send exists, but the delivery contract requires manual review",
    };
  }

  const claimed = await db.gatewayDelivery.updateMany({
    where: {
      id: delivery.id,
      OR: [
        { state: "PENDING" },
        { state: "FAILED", nextAttemptAt: { lte: claimAt } },
      ],
    },
    data: { state: "SENDING", attempts: { increment: 1 }, lastError: null, nextAttemptAt: null },
  });
  if (claimed.count === 0) {
    const pending = await db.gatewayDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    if (pending.state === "DELIVERED") return { ok: true, deduped: true, deliveryId: delivery.id };
    if (pending.state === "SENT_UNVERIFIED") {
      return {
        ok: false,
        deduped: true,
        sent: true,
        requiresManualReview: true,
        deliveryId: pending.id,
        platformMessageId: pending.platformMessageId,
        error: pending.lastError || "Platform send exists, but the delivery contract requires manual review",
      };
    }
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
    // A platform message id means the send happened, but its reply semantics
    // could not be verified. Do not auto-retry and create a duplicate card.
    const unverifiedPlatformSend = Boolean(sent.metadata?.message_id);
    const nextAttemptAt = unverifiedPlatformSend ? null : retryAt(current.attempts, claimAt);
    await db.gatewayDelivery.update({
      where: { id: delivery.id },
      data: {
        state: unverifiedPlatformSend ? "SENT_UNVERIFIED" : "FAILED",
        platformMessageId: sent.metadata?.message_id ?? null,
        platformChatId: sent.metadata?.chat_id ?? null,
        platformParentId: sent.metadata?.reply_to_message_id ?? null,
        platformMessageType: sent.metadata?.msg_type ?? null,
        lastError: sent.output.slice(0, 2000),
        nextAttemptAt,
      },
    });
    if (unverifiedPlatformSend) {
      log.warn("Gateway delivery sent but contract verification failed; automatic retry disabled", {
        deliveryId: delivery.id,
        platformMessageId: sent.metadata?.message_id,
        platformChatId: sent.metadata?.chat_id,
        platformParentId: sent.metadata?.reply_to_message_id,
        platformMessageType: sent.metadata?.msg_type,
        error: sent.output.slice(0, 2000),
      });
    }
    if (nextAttemptAt) scheduleGatewayDeliveryRetry(nextAttemptAt, sender);
    return { ok: false, deliveryId: delivery.id, error: sent.output };
  }

  const metadata = sent.metadata ?? parseGatewaySendOutput(sent.output);
  const expectedReply = inbound.platformMessageId.trim();
  const requiresFeishuCardReceipt = normalize(inbound.session.platform) === "feishu";
  if (
    !metadata?.message_id ||
    metadata.send_mode !== "reply" ||
    metadata.reply_to_message_id !== expectedReply ||
    (requiresFeishuCardReceipt && normalizeChatId(metadata.chat_id) !== normalizeChatId(inbound.session.chatId)) ||
    (requiresFeishuCardReceipt && metadata.msg_type !== "interactive")
  ) {
    const error = [
      "Gateway could not confirm native reply delivery",
      `expected reply target=${expectedReply}`,
      `actual mode=${metadata?.send_mode ?? "unknown"}`,
      `actual target=${metadata?.reply_to_message_id ?? "unknown"}`,
      `expected chat=${normalizeChatId(inbound.session.chatId)}`,
      `actual chat=${normalizeChatId(metadata?.chat_id) || "unknown"}`,
      `expected message type=${requiresFeishuCardReceipt ? "interactive" : "platform-native"}`,
      `actual message type=${metadata?.msg_type ?? "unknown"}`,
      `message id=${metadata?.message_id ?? "unknown"}`,
    ].join("; ");
    const nextAttemptAt = metadata?.message_id ? null : retryAt(current.attempts, claimAt);
    await db.gatewayDelivery.update({
      where: { id: delivery.id },
      data: {
        state: metadata?.message_id ? "SENT_UNVERIFIED" : "FAILED",
        platformMessageId: metadata?.message_id ?? null,
        platformChatId: metadata?.chat_id ?? null,
        platformParentId: metadata?.reply_to_message_id ?? null,
        platformMessageType: metadata?.msg_type ?? null,
        lastError: error,
        nextAttemptAt,
      },
    });
    if (metadata?.message_id) {
      log.warn("Gateway delivery sent but receipt contract was incomplete; automatic retry disabled", {
        deliveryId: delivery.id,
        platformMessageId: metadata.message_id,
        platformChatId: metadata.chat_id,
        platformParentId: metadata.reply_to_message_id,
        platformMessageType: metadata.msg_type,
        error,
      });
    }
    if (nextAttemptAt) scheduleGatewayDeliveryRetry(nextAttemptAt, sender);
    return { ok: false, deliveryId: delivery.id, error };
  }
  await db.gatewayDelivery.update({
    where: { id: delivery.id },
    data: {
      state: "DELIVERED",
      platformMessageId: metadata?.message_id ?? null,
      platformChatId: metadata?.chat_id ?? null,
      platformParentId: metadata?.reply_to_message_id ?? null,
      platformMessageType: metadata?.msg_type ?? null,
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
  const inbound = await db.gatewayInbound.findUnique({
    where: { id: inboundId },
    select: {
      gateway: true,
      platform: true,
      chatId: true,
      senderId: true,
      session: {
        select: {
          project: { select: { id: true, name: true, workspaceId: true } },
        },
      },
    },
  });
  if (!inbound?.session) throw new Error("Gateway discussion session not found");
  const decision = await decideGatewayChannelAccess(inbound);
  if (!decision.allowed || !gatewayScopeAllowsProject(decision.scope, inbound.session.project)) {
    throw new Error("Gateway channel authorization changed before the discussion completed");
  }
  const canonical = await completeDiscussionTurn(inboundId, response);
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
  await db.$transaction(async (tx) => {
    const linked = await tx.gatewayTaskLink.findUnique({
      where: { inboundId },
      select: { taskId: true },
    });
    if (linked && linked.taskId !== task.id) {
      throw new Error("Gateway request is already durably linked to a different task");
    }
    await tx.gatewayTaskLink.upsert({
      where: { inboundId },
      create: { inboundId, taskId: task.id },
      update: {},
    });
    await tx.task.updateMany({
      where: { id: task.id, parentTaskId: null },
      data: { parentTaskId: inbound.session!.workbenchTaskId },
    });
    await tx.gatewayInbound.update({
      where: { id: inboundId },
      data: { createdTaskId: task.id, state: "PROCESSING", lastError: null },
    });
    await tx.workbenchEvent.updateMany({
      where: { dedupKey: `gateway-work:${inboundId}`, state: { not: "CONSUMED" } },
      data: { state: "CONSUMED", claimToken: null, claimedAt: null, consumedAt: new Date() },
    });
  });
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
  if (task.status !== "IN_REVIEW" && task.status !== "DONE") {
    throw new Error("Workbench must stop and review the task before final delivery");
  }
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
  const deliveryInput = {
    inboundId: input.inboundId,
    kind: "FINAL_RESULT" as const,
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
  };
  if (task.status === "IN_REVIEW") {
    const { updateTaskStatus } = await import("@/actions/task-actions");
    await updateTaskStatus(task.id, "DONE", {
      gatewayCompletionOutbox: {
        dedupKey: deliveryInput.dedupKey,
        sessionId: inbound.session.id,
        inboundId: inbound.id,
        kind: deliveryInput.kind,
        content: deliveryInput.content,
        presentation: JSON.stringify(deliveryInput.presentation),
        response: content,
      },
    });
  } else {
    // Compatibility/recovery path for tasks completed by an older Workbench
    // protocol: materialize the missing FINAL_RESULT outbox idempotently.
    await createOrGetDelivery({
      dedupKey: deliveryInput.dedupKey,
      sessionId: inbound.session.id,
      inboundId: inbound.id,
      kind: deliveryInput.kind,
      content: deliveryInput.content,
      presentation: deliveryInput.presentation,
    });
    await db.gatewayInbound.update({
      where: { id: input.inboundId },
      data: {
        state: "PROCESSED",
        processedAt: new Date(),
        response: content,
        lastError: null,
      },
    });
  }
  const result = await deliverGatewayResponse(deliveryInput, sender);
  return result;
}

export async function retryGatewayDeliveries(
  sender: DeliverySender = sendViaHarnessGateway,
  now = new Date(),
  limit = 50,
  options: { inboundId?: string } = {},
) {
  await db.gatewayDelivery.updateMany({
    where: {
      state: "SENDING",
      platformMessageId: { not: null },
      updatedAt: { lt: new Date(now.getTime() - 60_000) },
      ...(options.inboundId ? { inboundId: options.inboundId } : {}),
    },
    data: {
      state: "SENT_UNVERIFIED",
      nextAttemptAt: null,
      lastError: "Stale delivery claim has a platform message id; automatic retry disabled pending manual review",
    },
  });
  await db.gatewayDelivery.updateMany({
    where: {
      state: "SENDING",
      platformMessageId: null,
      updatedAt: { lt: new Date(now.getTime() - 60_000) },
      ...(options.inboundId ? { inboundId: options.inboundId } : {}),
    },
    data: { state: "FAILED", nextAttemptAt: now, lastError: "Stale delivery claim recovered" },
  });
  const rows = await db.gatewayDelivery.findMany({
    where: {
      ...(options.inboundId ? { inboundId: options.inboundId } : {}),
      OR: [
        { state: "PENDING" },
        { state: "FAILED", nextAttemptAt: { lte: now } },
      ],
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
      ...(options.inboundId ? { inboundId: options.inboundId } : {}),
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
  restoreBoundary: (taskId: string) => boolean = restoreWorkbenchCommandConsumer,
  options: { projectId?: string; inboundId?: string } = {},
) {
  const rows = await db.gatewayInbound.findMany({
    where: {
      intent: "PROJECT_WORK",
      state: { in: ["QUEUED", "PROCESSING"] },
      sessionId: { not: null },
      ...(options.inboundId ? { id: options.inboundId } : {}),
      ...(options.projectId ? { session: { projectId: options.projectId } } : {}),
    },
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
      const durableLink = await db.gatewayTaskLink.findUnique({
        where: { inboundId: inbound.id },
        select: { taskId: true },
      });
      let linkedTask = durableLink
        ? await db.task.findUnique({
            where: { id: durableLink.taskId },
            select: { id: true },
          })
        : null;
      if (durableLink && !linkedTask) {
        // Defensive cleanup for pre-0028 databases or foreign-key-disabled
        // manual edits. Never treat a bare link row as proof that a task exists.
        await db.$transaction([
          db.gatewayTaskLink.deleteMany({
            where: { inboundId: inbound.id, taskId: durableLink.taskId },
          }),
          db.gatewayInbound.updateMany({
            where: { id: inbound.id, createdTaskId: durableLink.taskId },
            data: { createdTaskId: null },
          }),
        ]);
      }
      if (!linkedTask && inbound.createdTaskId) {
        linkedTask = await db.task.findUnique({
          where: { id: inbound.createdTaskId },
          select: { id: true },
        });
      }
      if (!linkedTask) {
        // Legacy crash window (before gatewayInboundId existed): only recover
        // when exactly one child of this Workbench was created after the inbound.
        const candidates = await db.task.findMany({
          where: {
            id: { not: taskId },
            projectId: inbound.session!.projectId,
            OR: [
              { parentTaskId: taskId, createdAt: { gte: inbound.createdAt } },
              // Pre-link legacy window: the real incident created its task
              // seconds after the request but lost parent metadata as well.
              // Keep this deliberately narrow and require one unique match.
              {
                parentTaskId: null,
                createdAt: {
                  gte: inbound.createdAt,
                  lte: new Date(inbound.createdAt.getTime() + 2 * 60_000),
                },
              },
            ],
          },
          orderBy: { createdAt: "asc" },
          take: 2,
          select: { id: true },
        });
        if (candidates.length === 1) linkedTask = candidates[0]!;
      }
      if (linkedTask) {
        await confirmGatewayTaskCreated(inbound.id, linkedTask.id, taskId, sender);
        const [linkedState, finalDelivery] = await Promise.all([
          db.task.findUnique({
            where: { id: linkedTask.id },
            select: { status: true },
          }),
          db.gatewayDelivery.findFirst({
            where: {
              inboundId: inbound.id,
              kind: "FINAL_RESULT",
            },
            orderBy: { createdAt: "desc" },
            select: { content: true },
          }),
        ]);
        // A FINAL_RESULT outbox row is durable proof that business processing
        // crossed its completion boundary. Transport may still be retrying or
        // awaiting manual verification, but that must not resurrect Workbench.
        if (linkedState?.status === "DONE" && finalDelivery) {
          await db.gatewayInbound.update({
            where: { id: inbound.id },
            data: {
              state: "PROCESSED",
              processedAt: inbound.processedAt ?? new Date(),
              response: finalDelivery.content,
              lastError: null,
            },
          });
          continue;
        }
        if (linkedState?.status === "IN_REVIEW") {
          const unresolvedReview = await db.workbenchEvent.findFirst({
            where: {
              parentTaskId: taskId,
              sourceTaskId: linkedTask.id,
              kind: { in: ["CHILD_REVIEW_REQUIRED", "CHILD_DECISION_REQUIRED"] },
              state: "CONSUMED",
            },
            orderBy: { consumedAt: "desc" },
            select: { id: true },
          });
          if (unresolvedReview) {
            const atTurnBoundary = restoreBoundary(taskId);
            await requeueAbandonedWorkbenchEvent({
              eventId: unresolvedReview.id,
              parentTaskId: taskId,
              reason: `Workbench exited before resolving review for gateway inbound ${inbound.id}`,
              atTurnBoundary,
            });
          }
        }
        const resumed = await ensureWorkbench(taskId);
        if (resumed.mode !== "already_running") {
          // The resumed provider must confirm its first completed turn before
          // queued work can be injected.
          activateWorkbenchCommandConsumer(taskId, resumed.mode);
        } else {
          restoreBoundary(taskId);
        }
        started++;
        continue;
      }
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
        accessMode: project.accessMode,
        workspaceId: project.workspaceId,
        workspaceName: project.workspace.name,
      };
      const event = await publishWorkbenchCommand({
        parentTaskId: taskId,
        sourceTaskId: taskId,
        kind: "GATEWAY_WORK_REQUEST",
        priority: "NORMAL",
        dedupKey: `gateway-work:${inbound.id}`,
        payload: {
          childTaskId: taskId,
          childTitle: `${project.name} gateway request`,
          instruction: workbenchPrompt(queuedInput, inbound.id, gatewayProject),
          sourceReference: { namespace: "gateway_inbound", id: inbound.id },
        },
      });
      if (event.event.state === "CONSUMED") {
        const atTurnBoundary = restoreBoundary(taskId);
        await requeueAbandonedWorkbenchEvent({
          eventId: event.event.id,
          parentTaskId: taskId,
          reason: `Workbench exited before creating a task for gateway inbound ${inbound.id}`,
          atTurnBoundary,
        });
      }
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
        // A server restart loses process-local boundary state. A resumed PTY is
        // still BUSY until its provider callback (or durable replay) confirms
        // the first completed turn.
        activateWorkbenchCommandConsumer(taskId, resumed.mode);
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
