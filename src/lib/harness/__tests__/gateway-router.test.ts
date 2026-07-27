import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
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
  type GatewayInboundRequest,
} from "../gateway-router";

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

async function configureChannel(input: {
  defaultProjectId?: string;
  allowedProjectIds?: string[];
} = {}) {
  await db.systemConfig.upsert({
    where: { key: GATEWAY_CHANNEL_BINDINGS_KEY },
    update: {
      value: JSON.stringify([{
        gateway: "openclaw",
        platform: "feishu",
        chatId: "oc_gateway_test",
        defaultWorkspaceId: workspaceId,
        ...input,
      }]),
    },
    create: {
      key: GATEWAY_CHANNEL_BINDINGS_KEY,
      value: JSON.stringify([{
        gateway: "openclaw",
        platform: "feishu",
        chatId: "oc_gateway_test",
        defaultWorkspaceId: workspaceId,
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
  vi.useRealTimers();
  const assistantIds = await db.gatewaySession.findMany({
    where: { project: { workspaceId } },
    select: { assistantSessionId: true },
  });
  await db.assistantSession.deleteMany({
    where: { id: { in: assistantIds.flatMap((row) => row.assistantSessionId ? [row.assistantSessionId] : []) } },
  });
  await db.workspace.delete({ where: { id: workspaceId } });
  await db.systemConfig.deleteMany({ where: { key: GATEWAY_CHANNEL_BINDINGS_KEY } });
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
    }), vi.fn(async () => ({ mode: "already_running", executionId: "wb-exec" })));
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
    await completeGatewayDiscussion(betaDiscussion.inboundId, "Beta project answer", vi.fn(async () => ({
      ok: true as const,
      output: JSON.stringify({ message_id: "om_beta_answer", channel: "feishu" }),
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

    const sender = vi.fn(async () => ({ ok: true as const, output: JSON.stringify({ message_id: "om_discussion_once" }) }));
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

  it("queues one durable event while a Workbench is busy and retries idempotent recovery", async () => {
    const ensure = vi.fn()
      .mockResolvedValueOnce({ mode: "already_running", executionId: "running-exec" });
    const request = inbound({ project: alphaId, intent: "PROJECT_WORK", content: "Build the import flow" });

    const first = await routeGatewayInbound(request, ensure);
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
    expect(await db.gatewayInbound.count({ where: { platformMessageId: request.platformMessageId } })).toBe(1);
    expect(await db.workbenchEvent.count({ where: { dedupKey: { startsWith: "gateway-work:" } } })).toBe(1);
    expect(await db.workbenchEvent.findFirst({ where: { dedupKey: { startsWith: "gateway-work:" } } }))
      .toMatchObject({ state: "PENDING", sourceTaskId: first.mode === "project_work" ? first.workbenchTaskId : "" });
    expect(await db.gatewayInbound.findFirst({ where: { platformMessageId: request.platformMessageId } }))
      .toMatchObject({ state: "QUEUED", createdTaskId: null });
  });

  it("recreates a missing durable event and resumes an unstarted Workbench", async () => {
    const routed = await routeGatewayInbound(
      inbound({ project: alphaId, intent: "PROJECT_WORK", content: "Recover this queued request" }),
      vi.fn(async () => ({ mode: "started", executionId: "initial-exec" })),
    );
    expect(routed.mode).toBe("project_work");
    if (routed.mode !== "project_work") return;

    await db.workbenchEvent.deleteMany({ where: { dedupKey: `gateway-work:${routed.inboundId}` } });
    const ensure = vi.fn(async () => ({ mode: "continued", executionId: "recovered-exec" }));

    await expect(recoverQueuedGatewayWork(ensure)).resolves.toEqual({ scanned: 1, started: 1, failed: 0 });
    expect(ensure).toHaveBeenCalledWith(routed.workbenchTaskId);
    expect(await db.workbenchEvent.findFirst({
      where: {
        parentTaskId: routed.workbenchTaskId,
        dedupKey: `gateway-work:${routed.inboundId}`,
      },
    })).toMatchObject({ kind: "GATEWAY_WORK_REQUEST", state: "PENDING" });
  });
});

describe("gateway confirmations and delivery retry", () => {
  it("confirms only a real created task and sends the reviewed final result once", async () => {
    const routed = await routeGatewayInbound(
      inbound({ project: alphaId, intent: "PROJECT_WORK", content: "Implement gateway callbacks" }),
      vi.fn(async () => ({ mode: "already_running", executionId: "workbench-exec" })),
    );
    expect(routed.mode).toBe("project_work");
    if (routed.mode !== "project_work") return;

    const child = await db.task.create({ data: { title: "Gateway callback implementation", projectId: alphaId } });
    const sender = vi.fn(async (sendInput: { message: string; replyToMessageId?: string | null }) => ({
      ok: true as const,
      output: JSON.stringify({ channel: "feishu", chat_id: "oc_gateway_test", message_id: "om_sent" }),
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

    await db.task.update({ where: { id: child.id }, data: { status: "DONE", doneAt: new Date() } });
    await db.taskExecution.create({
      data: {
        taskId: child.id,
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

    const retrySender = vi.fn(async () => ({
      ok: true as const,
      output: JSON.stringify({ message_id: "om_retry_success", channel: "feishu" }),
    }));
    await expect(retryGatewayDeliveries(retrySender, new Date(Date.now() + 10 * 60_000)))
      .resolves.toEqual({ scanned: 1, delivered: 1, failed: 0 });
    expect(retrySender).toHaveBeenCalledWith(expect.objectContaining({
      replyToMessageId: "om_original",
      threadId: "omt_discussion",
    }));
    expect(await db.gatewayDelivery.findFirst({ where: { inboundId: routed.inboundId } }))
      .toMatchObject({ state: "DELIVERED", attempts: 2, platformMessageId: "om_retry_success" });
    expect(await db.gatewayInbound.findUnique({ where: { id: routed.inboundId } }))
      .toMatchObject({ state: "PROCESSED" });
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
      .mockResolvedValueOnce({
        ok: true as const,
        output: JSON.stringify({ message_id: "om_auto_retry_success", channel: "feishu" }),
      });

    await expect(completeGatewayDiscussion(routed.inboundId, "Retry this answer", sender))
      .resolves.toMatchObject({ ok: false, error: "temporary automatic retry failure" });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    await expect(completeGatewayDiscussion(routed.inboundId, "Retry this answer", sender))
      .resolves.toMatchObject({ ok: false, deduped: true, pendingRetry: true });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(2));
    expect(await db.gatewayDelivery.findFirst({ where: { inboundId: routed.inboundId } }))
      .toMatchObject({ state: "DELIVERED", attempts: 2, platformMessageId: "om_auto_retry_success" });
    expect(await db.gatewayInbound.findUnique({ where: { id: routed.inboundId } }))
      .toMatchObject({ state: "PROCESSED" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
