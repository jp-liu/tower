import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  hasWorkbenchDrainBoundary,
  resetWorkbenchDrainBoundariesForTests,
} from "@/lib/workbench/boundary";
import { openWorkbenchDrainBoundary } from "@/lib/workbench/coordinator";
import {
  GATEWAY_CHANNEL_BINDINGS_KEY,
  GATEWAY_RECENT_SESSION_TTL_MS,
  completeGatewayDiscussion,
  completeGatewayWork,
  confirmGatewayTaskCreated,
  recoverQueuedGatewayWork,
  resetGatewayDeliveryRetrySchedulerForTests,
  retryGatewayDeliveries,
  routeGatewayInbound,
  routeGatewayProjectQuery,
  readGatewayProjectContext,
  type GatewayInboundRequest,
} from "../gateway-router";
import type { HarnessGatewaySendInput } from "../gateway-send";
import { diagnoseGatewayRequest } from "../gateway-diagnostics";

let workspaceId: string;
let alphaId: string;
let betaId: string;

function inbound(overrides: Partial<GatewayInboundRequest> = {}): GatewayInboundRequest {
  return {
    gateway: "openclaw",
    platform: "feishu",
    chatId: "oc_gateway_test",
    platformMessageId: `om_${randomUUID()}`,
    senderId: "ou_gateway_user",
    intent: "PROJECT_DISCUSSION",
    content: "Discuss the next release",
    ...overrides,
  };
}

function successfulSender(messageId = `om_sent_${randomUUID()}`) {
  return vi.fn(async (input: HarnessGatewaySendInput) => {
    void input;
    return {
      ok: true as const,
      output: JSON.stringify({ channel: "feishu", chat_id: "oc_gateway_test", message_id: messageId }),
      metadata: {
        chat_id: "oc_gateway_test",
        message_id: messageId,
        reply_to_message_id: input.replyToMessageId ?? undefined,
        msg_type: "interactive",
        send_mode: "reply" as const,
      },
      resolvedDest: "feishu:oc_gateway_test",
    };
  });
}

async function configureChannel(input: {
  defaultProjectId?: string;
  allowedProjectIds?: string[];
  defaultWorkspaceId?: string;
} = {}) {
  await db.systemConfig.upsert({
    where: { key: GATEWAY_CHANNEL_BINDINGS_KEY },
    update: {
      value: JSON.stringify([{
        gateway: "openclaw",
        platform: "feishu",
        chatId: "oc_gateway_test",
        defaultWorkspaceId: input.defaultWorkspaceId === undefined
          ? workspaceId
          : input.defaultWorkspaceId || undefined,
        ...input,
      }]),
    },
    create: {
      key: GATEWAY_CHANNEL_BINDINGS_KEY,
      value: JSON.stringify([{
        gateway: "openclaw",
        platform: "feishu",
        chatId: "oc_gateway_test",
        defaultWorkspaceId: input.defaultWorkspaceId === undefined
          ? workspaceId
          : input.defaultWorkspaceId || undefined,
        ...input,
      }]),
    },
  });
}

beforeEach(async () => {
  const workspace = await db.workspace.create({ data: { name: `gateway-test-${randomUUID()}` } });
  workspaceId = workspace.id;
  const [alpha, beta] = await Promise.all([
    db.project.create({
      data: { name: "Alpha Portal", alias: "alpha", workspaceId, localPath: process.cwd() },
    }),
    db.project.create({
      data: { name: "Alpha Service", alias: "beta", workspaceId, localPath: process.cwd() },
    }),
  ]);
  alphaId = alpha.id;
  betaId = beta.id;
  await configureChannel({ allowedProjectIds: [alphaId, betaId] });
});

afterEach(async () => {
  resetGatewayDeliveryRetrySchedulerForTests();
  resetWorkbenchDrainBoundariesForTests();
  vi.useRealTimers();
  const assistantIds = await db.gatewaySession.findMany({
    where: { project: { workspaceId } },
    select: { assistantSessionId: true },
  });
  await db.assistantSession.deleteMany({
    where: { id: { in: assistantIds.flatMap((row) => row.assistantSessionId ? [row.assistantSessionId] : []) } },
  });
  await db.workspace.delete({ where: { id: workspaceId } });
  await db.systemConfig.deleteMany({
    where: { key: { in: [GATEWAY_CHANNEL_BINDINGS_KEY, "assistant.historyTurns"] } },
  });
  await db.gatewayInbound.deleteMany({ where: { chatId: "oc_gateway_test" } });
  vi.restoreAllMocks();
});

describe("gateway inbound routing", () => {
  it("deduplicates direct inbound messages without starting a Workbench", async () => {
    const ensure = vi.fn(async () => ({ mode: "started", executionId: "exec" }));
    const request = inbound({ intent: "DIRECT", content: "What time is it?" });

    const first = await routeGatewayInbound(request, ensure);
    const duplicate = await routeGatewayInbound(request, ensure);

    expect(first).toMatchObject({ mode: "gateway_direct", deduped: false });
    expect(duplicate).toEqual({
      mode: "already_processed",
      inboundId: first.inboundId,
      deduped: true,
      noOp: true,
      state: "PROCESSED",
    });
    expect(duplicate).not.toHaveProperty("instructions");
    expect(ensure).not.toHaveBeenCalled();
    expect(await db.gatewayInbound.count({ where: { platformMessageId: request.platformMessageId } })).toBe(1);
  });

  it("does not execute a duplicate Tower command twice", async () => {
    const request = inbound({ intent: "TOWER", content: "Move task A to done" });

    const first = await routeGatewayInbound(request, vi.fn());
    const duplicate = await routeGatewayInbound(request, vi.fn());

    expect(first).toMatchObject({ mode: "tower_mcp", deduped: false });
    expect(duplicate).toMatchObject({
      mode: "already_processed",
      inboundId: first.inboundId,
      noOp: true,
      state: "PROCESSED",
    });
    expect(duplicate).not.toHaveProperty("instructions");
  });

  it("rate-limits a sender before dispatching more trusted-channel work", async () => {
    await db.gatewayInbound.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        dedupKey: `rate-sender-${index}`,
        gateway: "openclaw",
        platform: "feishu",
        chatId: "oc_gateway_test",
        senderId: "ou_gateway_user",
        platformMessageId: `rate-message-${index}`,
        intent: "DIRECT" as const,
        content: "read-only query",
        state: "PROCESSED",
      })),
    });

    const ensure = vi.fn();
    const routed = await routeGatewayInbound(inbound({
      platformMessageId: "rate-message-blocked",
      intent: "PROJECT_WORK",
      content: "Create and start more work",
    }), ensure);

    expect(routed).toMatchObject({
      mode: "rate_limited",
      scope: "sender",
      retryAfterSeconds: 60,
    });
    expect(ensure).not.toHaveBeenCalled();
    expect(await db.workbenchEvent.count({ where: { kind: "GATEWAY_WORK_REQUEST" } })).toBe(0);
  });

  it("applies a hard queued-work cap before accepting more channel work", async () => {
    await db.gatewayInbound.createMany({
      data: Array.from({ length: 50 }, (_, index) => ({
        dedupKey: `queue-cap-${index}`,
        gateway: "openclaw",
        platform: "feishu",
        chatId: "oc_gateway_test",
        senderId: `queue-sender-${index}`,
        platformMessageId: `queue-message-${index}`,
        intent: "PROJECT_WORK" as const,
        content: "queued work",
        state: "QUEUED",
      })),
    });

    const ensure = vi.fn();
    const routed = await routeGatewayInbound(inbound({
      platformMessageId: "queue-message-blocked",
      intent: "PROJECT_WORK",
      content: "Create and start more work",
    }), ensure);

    expect(routed).toMatchObject({
      mode: "rate_limited",
      scope: "queue",
      retryAfterSeconds: 120,
    });
    expect(ensure).not.toHaveBeenCalled();
  });

  it("keeps the non-owner capability project-read-only even when the message asks for work", async () => {
    const task = await db.task.create({ data: { title: "Existing private task", projectId: alphaId } });
    const request = inbound({
      project: alphaId,
      intent: "PROJECT_WORK",
      taskId: task.id,
      content: "Create a task, run the terminal, and modify the repository",
    });

    const routed = await routeGatewayProjectQuery(request);

    expect(routed).toMatchObject({
      mode: "project_discussion",
      project: { projectId: alphaId },
    });
    expect(routed.mode).not.toBe("task_reply");
    expect(routed.mode).not.toBe("project_work");
    expect(await db.workbenchEvent.count({ where: { kind: "GATEWAY_WORK_REQUEST" } })).toBe(0);

    const context = await readGatewayProjectContext(routed.inboundId, "What is the current project status?");
    expect(context).toMatchObject({
      inboundId: routed.inboundId,
      project: { projectId: alphaId, workspaceId },
    });
    expect(context.tasks).toContainEqual(expect.objectContaining({ title: "Existing private task" }));
    expect(context.knowledge.projects[0]).not.toHaveProperty("localPath");
  });

  it("routes work requests for REVIEW_ONLY projects into discussion without starting a Workbench", async () => {
    await db.project.update({ where: { id: alphaId }, data: { accessMode: "REVIEW_ONLY" } });

    const routed = await routeGatewayInbound(inbound({
      project: alphaId,
      intent: "PROJECT_WORK",
      content: "Install dependencies and implement the requested change",
    }), vi.fn());

    expect(routed).toMatchObject({
      mode: "project_discussion",
      project: { projectId: alphaId },
    });
    if (routed.mode === "project_discussion") {
      expect(routed.instructions).toContain("REVIEW_ONLY");
    }
    expect(await db.workbenchEvent.count({ where: { kind: "GATEWAY_WORK_REQUEST" } })).toBe(0);
  });

  it("fails closed when a non-owner channel has no configured project scope", async () => {
    await db.systemConfig.delete({ where: { key: GATEWAY_CHANNEL_BINDINGS_KEY } });

    await expect(routeGatewayProjectQuery(inbound({ project: alphaId }))).resolves.toMatchObject({
      mode: "needs_project_selection",
      candidates: [],
      reason: "not_allowed",
    });
  });

  it("fails closed when a non-owner channel binding has neither a workspace nor projects", async () => {
    await configureChannel({ defaultWorkspaceId: "", allowedProjectIds: [] });

    await expect(routeGatewayProjectQuery(inbound({ project: alphaId }))).resolves.toMatchObject({
      mode: "needs_project_selection",
      candidates: [],
      reason: "not_allowed",
    });
  });

  it("rechecks non-owner project scope when project context is read", async () => {
    const routed = await routeGatewayProjectQuery(inbound({ project: alphaId }));
    expect(routed).toMatchObject({ mode: "project_discussion" });

    await db.systemConfig.delete({ where: { key: GATEWAY_CHANNEL_BINDINGS_KEY } });

    await expect(readGatewayProjectContext(routed.inboundId, "status"))
      .rejects.toThrow("not authorized");
  });

  it("does not process a concurrent duplicate while its first route is still claimed", async () => {
    const request = inbound({ intent: "DIRECT", content: "Answer only once" });
    await db.gatewayInbound.create({
      data: {
        dedupKey: `gateway-inbound:openclaw:feishu:oc_gateway_test:${request.platformMessageId}`,
        gateway: "openclaw",
        platform: "feishu",
        chatId: "oc_gateway_test",
        platformMessageId: request.platformMessageId,
        senderId: request.senderId,
        intent: "DIRECT",
        content: request.content,
      },
    });

    await expect(routeGatewayInbound(request, vi.fn())).resolves.toMatchObject({
      mode: "in_progress",
      deduped: true,
    });
  });

  it("returns candidates for ambiguous identify_project matches instead of guessing", async () => {
    const result = await routeGatewayInbound(inbound({ project: "Al", intent: "PROJECT_WORK" }), vi.fn());

    expect(result).toMatchObject({ mode: "needs_project_selection", reason: "ambiguous" });
    if (result.mode === "needs_project_selection") {
      expect(result.candidates.map((item) => item.projectId).sort()).toEqual([alphaId, betaId].sort());
    }
    expect(await db.workbenchEvent.count()).toBe(0);
  });

  it("prioritizes reply task binding, then thread session binding, over an explicit project", async () => {
    const discussion = await routeGatewayInbound(inbound({
      project: alphaId,
      threadId: "omt_thread_1",
      rootMessageId: "om_root_1",
    }), vi.fn());
    expect(discussion).toMatchObject({ mode: "project_discussion", project: { projectId: alphaId } });

    const threadBound = await routeGatewayInbound(inbound({
      platformMessageId: "om_thread_followup",
      project: betaId,
      threadId: "omt_thread_1",
      intent: "PROJECT_WORK",
      content: "Implement this change",
    }), vi.fn(async () => ({ mode: "already_running", executionId: "wb-exec" })), successfulSender());
    expect(threadBound).toMatchObject({
      mode: "project_work",
      project: { projectId: alphaId },
      resolution: "thread_session_binding",
    });

    const betaTask = await db.task.create({ data: { title: "Beta task", projectId: betaId } });
    const replyBound = await routeGatewayInbound(inbound({
      platformMessageId: "om_task_reply",
      project: alphaId,
      threadId: "omt_thread_1",
      taskId: betaTask.id,
      intent: "PROJECT_DISCUSSION",
      content: "Continue this task",
    }), vi.fn());
    expect(replyBound).toMatchObject({
      mode: "task_reply",
      taskId: betaTask.id,
      project: { projectId: betaId },
      resolution: "reply_binding",
    });

    const betaDiscussion = await routeGatewayInbound(inbound({
      platformMessageId: "om_beta_question",
      project: betaId,
      threadId: "omt_beta_thread",
    }), vi.fn());
    expect(betaDiscussion.mode).toBe("project_discussion");
    if (betaDiscussion.mode !== "project_discussion") return;
    await completeGatewayDiscussion(betaDiscussion.inboundId, "Beta project answer", vi.fn(async (input: HarnessGatewaySendInput) => ({
      ok: true as const,
      output: JSON.stringify({ message_id: "om_beta_answer", channel: "feishu" }),
      metadata: { chat_id: "oc_gateway_test", message_id: "om_beta_answer", reply_to_message_id: input.replyToMessageId!, msg_type: "interactive", send_mode: "reply" as const },
    })));

    const deliveryBound = await routeGatewayInbound(inbound({
      platformMessageId: "om_reply_to_beta_answer",
      replyToMessageId: "om_beta_answer",
      project: alphaId,
      threadId: "omt_thread_1",
    }), vi.fn());
    expect(deliveryBound).toMatchObject({
      mode: "project_discussion",
      project: { projectId: betaId },
      resolution: "reply_message_binding",
    });
  });

  it("does not relay a duplicate task reply twice", async () => {
    const task = await db.task.create({ data: { title: "Reply target", projectId: alphaId } });
    const request = inbound({
      platformMessageId: "om_duplicate_task_reply",
      taskId: task.id,
      intent: "PROJECT_DISCUSSION",
      content: "One task reply",
    });

    const first = await routeGatewayInbound(request, vi.fn());
    const duplicate = await routeGatewayInbound(request, vi.fn());

    expect(first).toMatchObject({ mode: "task_reply", taskId: task.id });
    expect(duplicate).toMatchObject({
      mode: "in_progress",
      inboundId: first.inboundId,
      noOp: true,
      state: "PROCESSING",
      originalMode: "task_reply",
    });
    expect(duplicate).not.toHaveProperty("instructions");

    await db.gatewayInbound.update({
      where: { id: first.inboundId },
      data: { updatedAt: new Date(Date.now() - 2 * 60_000) },
    });
    const staleDuplicate = await routeGatewayInbound(request, vi.fn());
    expect(staleDuplicate).toMatchObject({
      mode: "in_progress",
      inboundId: first.inboundId,
      noOp: true,
      state: "PROCESSING",
      originalMode: "task_reply",
    });
    expect(staleDuplicate).not.toHaveProperty("instructions");
    expect(staleDuplicate.mode).not.toBe("task_reply");
  });

  it("uses the sender's recent project before the channel default", async () => {
    await configureChannel({ allowedProjectIds: [alphaId, betaId], defaultProjectId: alphaId });
    await routeGatewayInbound(inbound({
      project: betaId,
      threadId: "recent-thread",
      senderId: "ou_recent",
    }), vi.fn());
    await db.gatewaySession.updateMany({
      where: { senderId: "ou_recent" },
      data: { chatId: "oc_previous_chat" },
    });

    const recent = await routeGatewayInbound(inbound({
      platformMessageId: "om_recent_followup",
      senderId: "ou_recent",
    }), vi.fn());
    expect(recent).toMatchObject({
      mode: "project_discussion",
      project: { projectId: betaId },
      resolution: "recent_user_project",
    });

    const fallback = await routeGatewayInbound(inbound({
      platformMessageId: "om_channel_default",
      senderId: "ou_new",
    }), vi.fn());
    expect(fallback).toMatchObject({
      mode: "project_discussion",
      project: { projectId: alphaId },
      resolution: "channel_default_project",
    });
  });

  it("keeps project discussions independent from the Workbench terminal", async () => {
    const ensure = vi.fn();
    const result = await routeGatewayInbound(inbound({ project: alphaId }), ensure);

    expect(result).toMatchObject({
      mode: "project_discussion",
      project: { projectId: alphaId },
    });
    expect(ensure).not.toHaveBeenCalled();
    expect(await db.assistantSession.findUnique({
      where: { id: result.mode === "project_discussion" ? result.assistantSessionId : "missing" },
    })).toMatchObject({ projectId: alphaId });
    expect(await db.workbenchEvent.count()).toBe(0);
  });

  it("returns no-op results for duplicate discussions before and after delivery", async () => {
    const request = inbound({ project: alphaId, content: "Discuss this once" });
    const first = await routeGatewayInbound(request, vi.fn());
    expect(first.mode).toBe("project_discussion");
    if (first.mode !== "project_discussion") return;

    const concurrent = await routeGatewayInbound(request, vi.fn());
    expect(concurrent).toMatchObject({
      mode: "in_progress",
      inboundId: first.inboundId,
      noOp: true,
      state: "PROCESSING",
      originalMode: "project_discussion",
    });
    expect(concurrent).not.toHaveProperty("instructions");

    const sender = successfulSender("om_discussion_once");
    await completeGatewayDiscussion(first.inboundId, "One answer", sender);
    const completed = await routeGatewayInbound(request, vi.fn());
    expect(completed).toMatchObject({
      mode: "already_processed",
      inboundId: first.inboundId,
      noOp: true,
      state: "PROCESSED",
    });
    expect(completed).not.toHaveProperty("instructions");
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("reuses an unthreaded discussion for the same chat and sender", async () => {
    const first = await routeGatewayInbound(inbound({
      platformMessageId: "om_sender_first",
      project: alphaId,
      senderId: "ou_stable_sender",
    }), vi.fn());
    const second = await routeGatewayInbound(inbound({
      platformMessageId: "om_sender_second",
      senderId: "ou_stable_sender",
    }), vi.fn());

    expect(first.mode).toBe("project_discussion");
    expect(second.mode).toBe("project_discussion");
    if (first.mode !== "project_discussion" || second.mode !== "project_discussion") return;
    expect(second.assistantSessionId).toBe(first.assistantSessionId);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.resolution).toBe("thread_session_binding");
  });

  it("isolates unthreaded discussion sessions by sender in a group chat", async () => {
    await configureChannel({ allowedProjectIds: [alphaId, betaId], defaultProjectId: alphaId });
    const first = await routeGatewayInbound(inbound({
      platformMessageId: "om_sender_a",
      senderId: "ou_sender_a",
    }), vi.fn());
    const second = await routeGatewayInbound(inbound({
      platformMessageId: "om_sender_b",
      senderId: "ou_sender_b",
    }), vi.fn());

    expect(first.mode).toBe("project_discussion");
    expect(second.mode).toBe("project_discussion");
    if (first.mode !== "project_discussion" || second.mode !== "project_discussion") return;
    expect(second.assistantSessionId).not.toBe(first.assistantSessionId);
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  it("does not use an expired session as the sender's recent project", async () => {
    await configureChannel({ allowedProjectIds: [alphaId, betaId], defaultProjectId: betaId });
    const first = await routeGatewayInbound(inbound({
      platformMessageId: "om_expired_first",
      project: alphaId,
      senderId: "ou_expired_sender",
    }), vi.fn());
    expect(first.mode).toBe("project_discussion");
    if (first.mode !== "project_discussion") return;
    await db.gatewaySession.update({
      where: { id: first.sessionId },
      data: { lastActivityAt: new Date(Date.now() - GATEWAY_RECENT_SESSION_TTL_MS - 1_000) },
    });

    const next = await routeGatewayInbound(inbound({
      platformMessageId: "om_after_expiry",
      senderId: "ou_expired_sender",
    }), vi.fn());
    expect(next).toMatchObject({
      mode: "project_discussion",
      project: { projectId: betaId },
      resolution: "channel_default_project",
    });
  });

  it("persists discussion turns and restores only the configured recent context", async () => {
    await db.systemConfig.upsert({
      where: { key: "assistant.historyTurns" },
      create: { key: "assistant.historyTurns", value: "2" },
      update: { value: "2" },
    });
    let sessionId = "";
    for (let index = 1; index <= 3; index++) {
      const routed = await routeGatewayInbound(inbound({
        platformMessageId: `om_history_${index}`,
        project: index === 1 ? alphaId : undefined,
        threadId: "omt_history",
        content: `question ${index}`,
      }), vi.fn());
      expect(routed.mode).toBe("project_discussion");
      if (routed.mode !== "project_discussion") return;
      sessionId = routed.assistantSessionId;
      await completeGatewayDiscussion(routed.inboundId, `answer ${index}`, successfulSender(`om_history_answer_${index}`));
    }

    const followup = await routeGatewayInbound(inbound({
      platformMessageId: "om_history_4",
      threadId: "omt_history",
      content: "question 4",
    }), vi.fn());
    expect(followup.mode).toBe("project_discussion");
    if (followup.mode !== "project_discussion") return;
    expect(followup.assistantSessionId).toBe(sessionId);
    expect(followup.history.truncated).toBe(true);
    expect(followup.history.messages.map((message) => message.text)).toEqual([
      "question 2", "answer 2", "question 3", "answer 3",
    ]);
    expect(await db.assistantMessage.count({ where: { sessionId } })).toBe(8);
    expect(await db.assistantTurn.count({ where: { sessionId } })).toBe(4);
  });

  it("completes a discussion turn after Assistant startup reconciliation interrupts it", async () => {
    const routed = await routeGatewayInbound(inbound({
      platformMessageId: "om_reconciled_turn",
      project: alphaId,
      threadId: "omt_reconciled_turn",
    }), vi.fn());
    expect(routed.mode).toBe("project_discussion");
    if (routed.mode !== "project_discussion") return;
    const turn = await db.assistantTurn.findFirstOrThrow({
      where: { sessionId: routed.assistantSessionId },
    });
    await db.$transaction([
      db.assistantTurn.update({
        where: { id: turn.id },
        data: { status: "INTERRUPTED", completedAt: new Date() },
      }),
      db.assistantMessage.updateMany({
        where: { turnId: turn.id, role: "ASSISTANT" },
        data: { status: "INTERRUPTED" },
      }),
    ]);

    await completeGatewayDiscussion(
      routed.inboundId,
      "Recovered discussion answer",
      successfulSender("om_reconciled_answer"),
    );
    expect(await db.assistantTurn.findUnique({ where: { id: turn.id } }))
      .toMatchObject({ status: "COMPLETE" });
    expect(await db.assistantMessage.findFirst({ where: { turnId: turn.id, role: "ASSISTANT" } }))
      .toMatchObject({ status: "COMPLETE", partsJson: expect.stringContaining("Recovered discussion answer") });
  });

  it("closes an explicit discussion and restores it when an old reply is used", async () => {
    const first = await routeGatewayInbound(inbound({
      platformMessageId: "om_lifecycle_first",
      project: alphaId,
      threadId: "omt_lifecycle",
    }), vi.fn());
    expect(first.mode).toBe("project_discussion");
    if (first.mode !== "project_discussion") return;
    await completeGatewayDiscussion(first.inboundId, "Lifecycle answer", successfulSender("om_lifecycle_answer"));

    const closed = await routeGatewayInbound(inbound({
      platformMessageId: "om_lifecycle_close",
      replyToMessageId: "om_lifecycle_answer",
      threadId: "omt_lifecycle",
      sessionAction: "CLOSE",
      content: "结束讨论",
    }), vi.fn());
    expect(closed).toMatchObject({ mode: "discussion_closed", closedSessionIds: [first.sessionId] });
    expect(await db.gatewaySession.findUnique({ where: { id: first.sessionId } }))
      .toMatchObject({ status: "CLOSED" });

    const restored = await routeGatewayInbound(inbound({
      platformMessageId: "om_lifecycle_restore",
      replyToMessageId: "om_lifecycle_answer",
      threadId: "omt_lifecycle",
      content: "继续旧讨论",
    }), vi.fn());
    expect(restored).toMatchObject({
      mode: "project_discussion",
      sessionId: first.sessionId,
      assistantSessionId: first.assistantSessionId,
      resolution: "reply_message_binding",
    });
    expect(await db.gatewaySession.findUnique({ where: { id: first.sessionId } }))
      .toMatchObject({ status: "ACTIVE" });
  });

  it("closes the old binding and creates a new one on an explicit project switch", async () => {
    const first = await routeGatewayInbound(inbound({
      platformMessageId: "om_switch_first",
      project: alphaId,
      threadId: "omt_switch_project",
    }), vi.fn());
    expect(first.mode).toBe("project_discussion");
    if (first.mode !== "project_discussion") return;

    const switched = await routeGatewayInbound(inbound({
      platformMessageId: "om_switch_second",
      project: betaId,
      threadId: "omt_switch_project",
      sessionAction: "NEW",
      content: "Switch to the beta project",
    }), vi.fn());
    expect(switched).toMatchObject({
      mode: "project_discussion",
      project: { projectId: betaId },
      resolution: "explicit_project",
    });
    if (switched.mode !== "project_discussion") return;
    expect(switched.sessionId).not.toBe(first.sessionId);
    expect(switched.assistantSessionId).not.toBe(first.assistantSessionId);
    expect(await db.gatewaySession.findUnique({ where: { id: first.sessionId } }))
      .toMatchObject({ status: "CLOSED" });
  });

  it("lets an explicit new-work intent override an old task reply binding", async () => {
    const task = await db.task.create({ data: { title: "Old task", projectId: alphaId } });
    const followup = await routeGatewayInbound(inbound({
      platformMessageId: "om_old_task_followup",
      taskId: task.id,
      intent: "PROJECT_DISCUSSION",
      content: "What is the current status?",
    }), vi.fn());
    expect(followup).toMatchObject({ mode: "task_reply", taskId: task.id });

    const newWork = await routeGatewayInbound(inbound({
      platformMessageId: "om_explicit_new_work",
      taskId: task.id,
      project: alphaId,
      intent: "PROJECT_WORK",
      content: "Create a new task for a separate implementation",
    }), vi.fn(async () => ({ mode: "already_running", executionId: "workbench-exec" })), successfulSender());
    expect(newWork).toMatchObject({ mode: "project_work", project: { projectId: alphaId } });
    expect(newWork.mode).not.toBe("task_reply");
  });

  it("queues one durable event while a Workbench is busy and retries idempotent recovery", async () => {
    const ensure = vi.fn()
      .mockResolvedValueOnce({ mode: "already_running", executionId: "running-exec" });
    const request = inbound({ project: alphaId, intent: "PROJECT_WORK", content: "Build the import flow" });

    const sender = successfulSender("om_queue_ack");
    const first = await routeGatewayInbound(request, ensure, sender);
    const retry = await routeGatewayInbound(request, ensure);

    expect(first).toMatchObject({ mode: "project_work", queued: true, workbench: { mode: "already_running" } });
    expect(retry).toMatchObject({
      mode: "in_progress",
      deduped: true,
      noOp: true,
      state: "QUEUED",
      originalMode: "project_work",
    });
    expect(retry).not.toHaveProperty("instructions");
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0][0]).toMatchObject({
      replyToMessageId: request.platformMessageId,
      presentation: { title: "⏳ 小塔 · 请求已进入工作台", tone: "warning" },
    });
    expect(await db.gatewayInbound.count({ where: { platformMessageId: request.platformMessageId } })).toBe(1);
    expect(await db.workbenchEvent.count({ where: { dedupKey: { startsWith: "gateway-work:" } } })).toBe(1);
    expect(await db.workbenchEvent.findFirst({ where: { dedupKey: { startsWith: "gateway-work:" } } }))
      .toMatchObject({ state: "PENDING", sourceTaskId: first.mode === "project_work" ? first.workbenchTaskId : "" });
    expect(await db.gatewayInbound.findFirst({ where: { platformMessageId: request.platformMessageId } }))
      .toMatchObject({ state: "QUEUED", createdTaskId: null });
  });

  it("correlates one platform message through routing, Workbench, task, and delivery stages", async () => {
    const request = inbound({
      project: alphaId,
      intent: "PROJECT_WORK",
      content: "Build a diagnostic trace",
    });
    const routed = await routeGatewayInbound(
      request,
      vi.fn(async () => ({ mode: "already_running", executionId: "trace-workbench" })),
      successfulSender("om_trace_queue"),
    );
    expect(routed.mode).toBe("project_work");
    if (routed.mode !== "project_work") return;

    const diagnostic = await diagnoseGatewayRequest({ platformMessageId: request.platformMessageId });

    expect(diagnostic).toMatchObject({
      traceId: routed.inboundId,
      source: { platformMessageId: request.platformMessageId },
      project: { projectId: alphaId },
      event: { state: "PENDING" },
    });
    expect(diagnostic.stages.map((item) => item.name)).toEqual([
      "platform_ingress",
      "tower_route",
      "workbench_inbox",
      "workbench_runtime",
      "child_task",
      "platform_delivery",
    ]);
    expect(diagnostic.deliveries).toContainEqual(expect.objectContaining({
      kind: "QUEUED_ACK",
      state: "DELIVERED",
      platformMessageId: "om_trace_queue",
    }));
    expect(JSON.stringify(diagnostic)).not.toContain(process.cwd());
  });

  it("opens the initial boundary after starting a Workbench for new gateway work", async () => {
    const ensure = vi.fn(async () => ({
      mode: "started" as const,
      executionId: "fresh-workbench",
    }));
    const routed = await routeGatewayInbound(
      inbound({ project: alphaId, intent: "PROJECT_WORK", content: "Wake the new Workbench" }),
      ensure,
      successfulSender("om_initial_boundary_ack"),
    );
    expect(routed.mode).toBe("project_work");
    if (routed.mode !== "project_work") return;

    expect(ensure).toHaveBeenCalledWith(routed.workbenchTaskId);
    expect(hasWorkbenchDrainBoundary(routed.workbenchTaskId)).toBe(true);
  });

  it("recreates a missing durable event and resumes an unstarted Workbench", async () => {
    const routed = await routeGatewayInbound(
      inbound({ project: alphaId, intent: "PROJECT_WORK", content: "Recover this queued request" }),
      vi.fn(async () => ({ mode: "started", executionId: "initial-exec" })),
      successfulSender("om_initial_queue_ack"),
    );
    expect(routed.mode).toBe("project_work");
    if (routed.mode !== "project_work") return;

    await db.workbenchEvent.deleteMany({ where: { dedupKey: `gateway-work:${routed.inboundId}` } });
    const ensure = vi.fn(async () => ({ mode: "continued", executionId: "recovered-exec" }));

    await expect(recoverQueuedGatewayWork(ensure, 100, successfulSender(), undefined, { projectId: alphaId }))
      .resolves.toEqual({ scanned: 1, started: 1, failed: 0 });
    expect(ensure).toHaveBeenCalledWith(routed.workbenchTaskId);
    expect(hasWorkbenchDrainBoundary(routed.workbenchTaskId)).toBe(true);
    expect(await db.workbenchEvent.findFirst({
      where: {
        parentTaskId: routed.workbenchTaskId,
        dedupKey: `gateway-work:${routed.inboundId}`,
      },
    })).toMatchObject({ kind: "GATEWAY_WORK_REQUEST", state: "PENDING" });
  });

  it("requeues a consumed gateway event when a resident Workbench returned to a turn boundary", async () => {
    const routed = await routeGatewayInbound(
      inbound({ project: alphaId, intent: "PROJECT_WORK", content: "Recover abandoned delivery" }),
      vi.fn(async () => ({ mode: "started", executionId: "initial-exec" })),
      successfulSender("om_abandoned_queue_ack"),
    );
    expect(routed.mode).toBe("project_work");
    if (routed.mode !== "project_work") return;
    await db.workbenchEvent.update({
      where: { dedupKey: `gateway-work:${routed.inboundId}` },
      data: { state: "CONSUMED", consumedAt: new Date() },
    });
    await db.gatewayInbound.update({
      where: { id: routed.inboundId },
      data: { state: "PROCESSING" },
    });
    await db.taskExecution.create({
      data: {
        taskId: routed.workbenchTaskId,
        status: "RUNNING",
        startedAt: new Date(),
      },
    });
    const ensure = vi.fn(async () => ({ mode: "continued" as const, executionId: "retry-exec" }));
    const restore = vi.fn(() => true);

    await expect(recoverQueuedGatewayWork(
      ensure,
      100,
      successfulSender("om_abandoned_retry"),
      restore,
      { projectId: alphaId },
    )).resolves.toEqual({ scanned: 1, started: 1, failed: 0 });
    expect(await db.workbenchEvent.findUnique({
      where: { dedupKey: `gateway-work:${routed.inboundId}` },
    })).toMatchObject({
      state: "PENDING",
      lastError: expect.stringContaining("exited before creating a task"),
    });
    expect(restore).toHaveBeenCalledWith(routed.workbenchTaskId);
    expect(ensure).toHaveBeenCalledWith(routed.workbenchTaskId);
  });

  it("restores a lost boundary for an already-running idle Workbench", async () => {
    const routed = await routeGatewayInbound(
      inbound({ project: alphaId, intent: "PROJECT_WORK", content: "Recover after Tower restart" }),
      vi.fn(async () => ({ mode: "already_running", executionId: "live-workbench" })),
      successfulSender("om_restart_queue_ack"),
    );
    expect(routed.mode).toBe("project_work");
    if (routed.mode !== "project_work") return;

    resetWorkbenchDrainBoundariesForTests();
    const ensure = vi.fn(async () => ({ mode: "already_running", executionId: "live-workbench" }));
    const restore = vi.fn((taskId: string) => {
      openWorkbenchDrainBoundary(taskId);
      return true;
    });

    await expect(recoverQueuedGatewayWork(
      ensure,
      100,
      successfulSender("om_restart_retry_ack"),
      restore,
      { projectId: alphaId },
    )).resolves.toEqual({ scanned: 1, started: 1, failed: 0 });
    expect(restore).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledWith(routed.workbenchTaskId);
    expect(hasWorkbenchDrainBoundary(routed.workbenchTaskId)).toBe(true);
  });

  it("does not restore a boundary while an already-running Workbench is busy", async () => {
    const routed = await routeGatewayInbound(
      inbound({ project: alphaId, intent: "PROJECT_WORK", content: "Queue while the Workbench is busy" }),
      vi.fn(async () => ({ mode: "already_running", executionId: "busy-workbench" })),
      successfulSender("om_busy_queue_ack"),
    );
    expect(routed.mode).toBe("project_work");
    if (routed.mode !== "project_work") return;

    resetWorkbenchDrainBoundariesForTests();
    const restore = vi.fn(() => false);
    await expect(recoverQueuedGatewayWork(
      vi.fn(async () => ({ mode: "already_running", executionId: "busy-workbench" })),
      100,
      successfulSender("om_busy_retry_ack"),
      restore,
      { projectId: alphaId },
    )).resolves.toEqual({ scanned: 1, started: 1, failed: 0 });
    expect(restore).toHaveBeenCalledWith(routed.workbenchTaskId);
    expect(hasWorkbenchDrainBoundary(routed.workbenchTaskId)).toBe(false);
    expect(await db.workbenchEvent.findFirst({ where: { dedupKey: `gateway-work:${routed.inboundId}` } }))
      .toMatchObject({ state: "PENDING" });
  });
});

describe("gateway confirmations and delivery retry", () => {
  it("keeps Task=DONE and a retryable FINAL_RESULT outbox when the platform send fails", async () => {
    const routed = await routeGatewayInbound(
      inbound({ project: alphaId, intent: "PROJECT_WORK", content: "Verify atomic completion" }),
      vi.fn(async () => ({ mode: "already_running", executionId: "workbench-exec" })),
      successfulSender("om_atomic_queue"),
    );
    expect(routed.mode).toBe("project_work");
    if (routed.mode !== "project_work") return;

    const child = await db.task.create({
      data: {
        title: "Atomic completion child",
        projectId: alphaId,
        parentTaskId: routed.workbenchTaskId,
        status: "IN_REVIEW",
      },
    });
    await db.taskExecution.create({
      data: {
        taskId: child.id,
        status: "COMPLETED",
        summary: "Atomic result",
        branchTipCommit: "deadbee",
        endedAt: new Date(),
      },
    });
    await confirmGatewayTaskCreated(
      routed.inboundId,
      child.id,
      routed.workbenchTaskId,
      successfulSender("om_atomic_created"),
    );
    const failingSender = vi.fn(async () => ({
      ok: false as const,
      output: "temporary Feishu transport failure",
    }));
    await expect(completeGatewayWork({
      inboundId: routed.inboundId,
      taskId: child.id,
      reviewerTaskId: routed.workbenchTaskId,
      resultSummary: "Reviewed atomically",
    }, failingSender)).resolves.toMatchObject({ ok: false });

    expect(await db.task.findUnique({ where: { id: child.id } })).toMatchObject({
      status: "DONE",
    });
    expect(await db.gatewayDelivery.findUnique({
      where: { dedupKey: `gateway-final:${routed.inboundId}:${child.id}` },
    })).toMatchObject({
      kind: "FINAL_RESULT",
      state: "FAILED",
      attempts: 1,
      lastError: "temporary Feishu transport failure",
    });
    expect(await db.gatewayInbound.findUnique({ where: { id: routed.inboundId } }))
      .toMatchObject({
        state: "PROCESSED",
        response: expect.stringContaining("Reviewed atomically"),
      });
  });

  it("does not restart Workbench when completed work already has a final outbox", async () => {
    const routed = await routeGatewayInbound(
      inbound({ project: alphaId, intent: "PROJECT_WORK", content: "Recover completed work without waking Workbench" }),
      vi.fn(async () => ({ mode: "already_running", executionId: "workbench-exec" })),
      successfulSender("om_completed_queue"),
    );
    expect(routed.mode).toBe("project_work");
    if (routed.mode !== "project_work") return;

    const child = await db.task.create({
      data: {
        title: "Already completed child",
        projectId: alphaId,
        parentTaskId: routed.workbenchTaskId,
        status: "DONE",
        doneAt: new Date(),
      },
    });
    await db.gatewayTaskLink.create({
      data: { inboundId: routed.inboundId, taskId: child.id },
    });
    await db.gatewayInbound.update({
      where: { id: routed.inboundId },
      data: { state: "PROCESSING", createdTaskId: child.id },
    });
    await db.gatewayDelivery.create({
      data: {
        dedupKey: `gateway-final:${routed.inboundId}:${child.id}`,
        sessionId: routed.sessionId,
        inboundId: routed.inboundId,
        kind: "FINAL_RESULT",
        content: "Durable final result",
        state: "SENT_UNVERIFIED",
      },
    });

    const ensureWorkbench = vi.fn();
    await expect(recoverQueuedGatewayWork(
      ensureWorkbench,
      100,
      successfulSender("om_completed_created"),
      undefined,
      { inboundId: routed.inboundId },
    )).resolves.toEqual({ scanned: 1, started: 0, failed: 0 });

    expect(ensureWorkbench).not.toHaveBeenCalled();
    expect(await db.gatewayInbound.findUnique({ where: { id: routed.inboundId } }))
      .toMatchObject({
        state: "PROCESSED",
        response: "Durable final result",
        lastError: null,
      });
  });

  it("confirms only a real created task and sends the reviewed final result once", async () => {
    const routed = await routeGatewayInbound(
      inbound({ project: alphaId, intent: "PROJECT_WORK", content: "Implement gateway callbacks" }),
      vi.fn(async () => ({ mode: "already_running", executionId: "workbench-exec" })),
      successfulSender("om_confirmation_queue_ack"),
    );
    expect(routed.mode).toBe("project_work");
    if (routed.mode !== "project_work") return;

    const child = await db.task.create({
      data: {
        title: "Gateway callback implementation",
        description: "## 目标\nImplement reliable gateway callbacks.\n\n## 来源\nGateway",
        priority: "HIGH",
        baseBranch: "main",
        projectId: alphaId,
      },
    });
    const execution = await db.taskExecution.create({
      data: {
        taskId: child.id,
        status: "RUNNING",
        worktreeBranch: "feat/gateway-callbacks",
        startedAt: new Date(),
      },
    });
    const sender = vi.fn(async (sendInput: HarnessGatewaySendInput) => ({
      ok: true as const,
      output: JSON.stringify({ channel: "feishu", chat_id: "oc_gateway_test", message_id: "om_sent" }),
      metadata: { chat_id: "oc_gateway_test", message_id: "om_sent", reply_to_message_id: sendInput.replyToMessageId!, msg_type: "interactive", send_mode: "reply" as const },
      resolvedDest: "feishu:oc_gateway_test",
      sendInput,
    }));

    await expect(confirmGatewayTaskCreated(routed.inboundId, "missing", routed.workbenchTaskId, sender))
      .rejects.toThrow("does not belong");
    await expect(confirmGatewayTaskCreated(routed.inboundId, child.id, "wrong-workbench", sender))
      .rejects.toThrow("bound project Workbench");
    await expect(confirmGatewayTaskCreated(routed.inboundId, child.id, routed.workbenchTaskId, sender))
      .resolves.toMatchObject({ ok: true, deduped: false });
    await expect(confirmGatewayTaskCreated(routed.inboundId, child.id, routed.workbenchTaskId, sender))
      .resolves.toMatchObject({ ok: true, deduped: true });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0][0].message).toContain(`Task created: ${child.title}`);
    expect(sender.mock.calls[0][0].message).toContain(`Tower task: ${child.id}`);
    expect(sender.mock.calls[0][0].presentation).toMatchObject({
      title: "🚀 小塔 · 任务已创建",
      tone: "success",
    });
    expect(JSON.stringify(sender.mock.calls[0][0].presentation)).toContain("Implement reliable gateway callbacks");
    expect(JSON.stringify(sender.mock.calls[0][0].presentation)).toContain("已启动 · 执行中");

    await db.task.update({ where: { id: child.id }, data: { status: "IN_REVIEW", doneAt: null } });
    await db.taskExecution.update({
      where: { id: execution.id },
      data: {
        status: "COMPLETED",
        summary: "Implemented and verified callbacks",
        gitLog: "abc1234 feat(task): connect gateway callbacks",
        branchTipCommit: "abc1234",
        worktreeBranch: "feat/gateway-callbacks",
        endedAt: new Date(),
      },
    });
    await db.gatewayInbound.update({ where: { id: routed.inboundId }, data: { createdTaskId: null } });
    await expect(completeGatewayWork({
      inboundId: routed.inboundId,
      taskId: child.id,
      reviewerTaskId: routed.workbenchTaskId,
    }, sender)).rejects.toThrow("must be confirmed");
    await db.gatewayInbound.update({ where: { id: routed.inboundId }, data: { createdTaskId: child.id } });
    await expect(completeGatewayWork({
      inboundId: routed.inboundId,
      taskId: child.id,
      reviewerTaskId: "wrong-workbench",
    }, sender)).rejects.toThrow("bound project Workbench");
    await expect(completeGatewayWork({
      inboundId: routed.inboundId,
      taskId: child.id,
      reviewerTaskId: routed.workbenchTaskId,
      resultSummary: "Reviewed and accepted",
    }, sender)).resolves.toMatchObject({ ok: true, deduped: false });
    expect(await db.task.findUnique({ where: { id: child.id } })).toMatchObject({
      status: "DONE",
    });
    expect(await db.gatewayDelivery.findUnique({
      where: { dedupKey: `gateway-final:${routed.inboundId}:${child.id}` },
    })).toMatchObject({
      kind: "FINAL_RESULT",
      state: "DELIVERED",
    });
    await expect(completeGatewayWork({
      inboundId: routed.inboundId,
      taskId: child.id,
      reviewerTaskId: routed.workbenchTaskId,
    }, sender)).resolves.toMatchObject({ ok: true, deduped: true });

    expect(sender).toHaveBeenCalledTimes(2);
    const finalMessage = sender.mock.calls[1][0].message;
    expect(finalMessage).toContain(`Task completed: ${child.title}`);
    expect(finalMessage).toContain("Result: Reviewed and accepted");
    expect(finalMessage).toContain("Commit: abc1234 feat(task): connect gateway callbacks");
    expect(finalMessage).toContain("Branch: feat/gateway-callbacks");
    expect(finalMessage).toContain(`Tower task: ${child.id}`);
    expect(sender.mock.calls[1][0].presentation).toMatchObject({
      title: "✅ 小塔 · 任务已完成",
      tone: "success",
    });
  });

  it("recovers a create-before-confirm crash by linking the existing task once", async () => {
    const routed = await routeGatewayInbound(
      inbound({ intent: "PROJECT_WORK", project: alphaId, content: "Create one read-only child task" }),
      vi.fn(async () => ({ mode: "started", executionId: "workbench-exec" })),
      successfulSender("om_queued"),
    );
    expect(routed.mode).toBe("project_work");
    if (routed.mode !== "project_work") return;

    const child = await db.task.create({
      data: { title: "Existing child", projectId: alphaId, parentTaskId: routed.workbenchTaskId },
    });
    await db.gatewayTaskLink.create({ data: { inboundId: routed.inboundId, taskId: child.id } });

    const sender = successfulSender("om_created");
    const ensureWorkbench = vi.fn(async () => ({
      mode: "already_running" as const,
      executionId: "workbench-exec",
    }));
    await expect(recoverQueuedGatewayWork(ensureWorkbench, 100, sender, undefined, { projectId: alphaId }))
      .resolves.toMatchObject({ scanned: 1, started: 1, failed: 0 });
    expect(ensureWorkbench).toHaveBeenCalledWith(routed.workbenchTaskId);
    expect(await db.gatewayInbound.findUnique({ where: { id: routed.inboundId } }))
      .toMatchObject({ createdTaskId: child.id, state: "PROCESSING" });
    expect(await db.task.count({ where: { parentTaskId: routed.workbenchTaskId } })).toBe(1);
    expect(await db.gatewayDelivery.count({
      where: { inboundId: routed.inboundId, kind: "TASK_CREATED" },
    })).toBe(1);

    await expect(recoverQueuedGatewayWork(ensureWorkbench, 100, sender, undefined, { projectId: alphaId }))
      .resolves.toMatchObject({ scanned: 1, started: 1, failed: 0 });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("removes the durable gateway link when its child task is deleted", async () => {
    const routed = await routeGatewayInbound(
      inbound({ intent: "PROJECT_WORK", project: alphaId, content: "Create a disposable child task" }),
      vi.fn(async () => ({ mode: "started", executionId: "workbench-exec" })),
      successfulSender("om_queued_for_delete"),
    );
    expect(routed.mode).toBe("project_work");
    if (routed.mode !== "project_work") return;

    const child = await db.task.create({
      data: { title: "Disposable child", projectId: alphaId, parentTaskId: routed.workbenchTaskId },
    });
    await db.gatewayTaskLink.create({
      data: { inboundId: routed.inboundId, taskId: child.id },
    });

    await db.task.delete({ where: { id: child.id } });

    expect(await db.gatewayTaskLink.findUnique({
      where: { inboundId: routed.inboundId },
    })).toBeNull();
    expect(await db.gatewayInbound.findUnique({
      where: { id: routed.inboundId },
      select: { state: true },
    })).toEqual({ state: "QUEUED" });
  });

  it("persists a failed discussion delivery and retries it against the original message", async () => {
    const request = inbound({ project: alphaId, rootMessageId: "om_original", threadId: "omt_discussion" });
    const routed = await routeGatewayInbound(request, vi.fn());
    expect(routed.mode).toBe("project_discussion");
    if (routed.mode !== "project_discussion") return;
    const failedSender = vi.fn(async () => ({ ok: false as const, output: "temporary gateway failure" }));
    await expect(completeGatewayDiscussion(routed.inboundId, "Project-aware answer", failedSender))
      .resolves.toMatchObject({ ok: false, error: "temporary gateway failure" });
    expect(await db.gatewayDelivery.findFirst({ where: { inboundId: routed.inboundId } }))
      .toMatchObject({ state: "FAILED", attempts: 1, lastError: "temporary gateway failure" });

    const retrySender = vi.fn(async (input: HarnessGatewaySendInput) => ({
      ok: true as const,
      output: JSON.stringify({ message_id: "om_retry_success", channel: "feishu" }),
      metadata: { chat_id: "oc_gateway_test", message_id: "om_retry_success", reply_to_message_id: input.replyToMessageId!, msg_type: "interactive", send_mode: "reply" as const },
    }));
    await expect(retryGatewayDeliveries(retrySender, new Date(Date.now() + 10 * 60_000)))
      .resolves.toEqual({ scanned: 1, delivered: 1, failed: 0 });
    expect(retrySender).toHaveBeenCalledWith(expect.objectContaining({
      replyToMessageId: request.platformMessageId,
      threadId: "omt_discussion",
      presentation: expect.objectContaining({ title: "💬 小塔 · 项目讨论" }),
    }));
    expect(await db.gatewayDelivery.findFirst({ where: { inboundId: routed.inboundId } }))
      .toMatchObject({ state: "DELIVERED", attempts: 2, platformMessageId: "om_retry_success" });
    expect(await db.gatewayInbound.findUnique({ where: { id: routed.inboundId } }))
      .toMatchObject({ state: "PROCESSED" });
  });

  it("does not replay a platform send whose native reply target cannot be verified", async () => {
    const request = inbound({ project: alphaId, rootMessageId: "om_unverified_root" });
    const routed = await routeGatewayInbound(request, vi.fn());
    expect(routed.mode).toBe("project_discussion");
    if (routed.mode !== "project_discussion") return;
    vi.useFakeTimers({ now: new Date("2026-07-28T04:00:00.000Z") });

    const sender = vi.fn(async () => ({
      ok: false as const,
      output: "platform message exists but has no parent_id",
      metadata: { message_id: "om_unverified_send" },
    }));
    await expect(completeGatewayDiscussion(routed.inboundId, "Do not duplicate this", sender))
      .resolves.toMatchObject({ ok: false });
    expect(await db.gatewayDelivery.findFirst({ where: { inboundId: routed.inboundId } }))
      .toMatchObject({
        state: "SENT_UNVERIFIED",
        attempts: 1,
        platformMessageId: "om_unverified_send",
        nextAttemptAt: null,
        lastError: "platform message exists but has no parent_id",
      });

    await expect(completeGatewayDiscussion(routed.inboundId, "Do not duplicate this", sender))
      .resolves.toMatchObject({
        ok: false,
        deduped: true,
        sent: true,
        requiresManualReview: true,
        platformMessageId: "om_unverified_send",
      });
    await expect(retryGatewayDeliveries(sender, new Date(Date.now() + 60 * 60_000)))
      .resolves.toEqual({ scanned: 0, delivered: 0, failed: 0 });
    expect(vi.getTimerCount()).toBe(0);

    const delivery = await db.gatewayDelivery.findFirstOrThrow({ where: { inboundId: routed.inboundId } });
    await db.gatewayDelivery.update({
      where: { id: delivery.id },
      data: { state: "SENDING", updatedAt: new Date(Date.now() - 2 * 60_000) },
    });
    await expect(retryGatewayDeliveries(sender, new Date()))
      .resolves.toEqual({ scanned: 0, delivered: 0, failed: 0 });
    expect(await db.gatewayDelivery.findUniqueOrThrow({ where: { id: delivery.id } }))
      .toMatchObject({ state: "SENT_UNVERIFIED", nextAttemptAt: null });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("automatically retries one failed delivery without duplicate timers or sends", async () => {
    const routed = await routeGatewayInbound(inbound({
      project: alphaId,
      rootMessageId: "om_auto_retry_root",
      threadId: "omt_auto_retry",
    }), vi.fn());
    expect(routed.mode).toBe("project_discussion");
    if (routed.mode !== "project_discussion") return;

    vi.useFakeTimers({ now: new Date("2026-07-27T08:00:00.000Z") });
    const sender = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, output: "temporary automatic retry failure" })
      .mockImplementationOnce(async (input: HarnessGatewaySendInput) => ({
        ok: true as const,
        output: JSON.stringify({ message_id: "om_auto_retry_success", channel: "feishu" }),
        metadata: { chat_id: "oc_gateway_test", message_id: "om_auto_retry_success", reply_to_message_id: input.replyToMessageId!, msg_type: "interactive", send_mode: "reply" as const },
      }));

    await expect(completeGatewayDiscussion(routed.inboundId, "Retry this answer", sender))
      .resolves.toMatchObject({ ok: false, error: "temporary automatic retry failure" });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    await expect(completeGatewayDiscussion(routed.inboundId, "A changed retry answer", sender))
      .resolves.toMatchObject({ ok: false, deduped: true, pendingRetry: true });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(2));
    expect(await db.gatewayDelivery.findFirst({ where: { inboundId: routed.inboundId } }))
      .toMatchObject({ state: "DELIVERED", attempts: 2, platformMessageId: "om_auto_retry_success" });
    expect(await db.gatewayInbound.findUnique({ where: { id: routed.inboundId } }))
      .toMatchObject({ state: "PROCESSED" });
    const storedAssistant = await db.assistantMessage.findFirst({
      where: { sessionId: routed.assistantSessionId, role: "ASSISTANT" },
    });
    expect(storedAssistant?.partsJson).toContain("Retry this answer");
    expect(storedAssistant?.partsJson).not.toContain("changed retry answer");
    expect(vi.getTimerCount()).toBe(0);
  });
});
