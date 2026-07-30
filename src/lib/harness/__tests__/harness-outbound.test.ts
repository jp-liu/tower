import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { sendViaHarnessGateway } from "@/lib/harness/gateway-send";
import {
  enqueueHarnessOutbound,
  recoverHarnessOutbounds,
} from "@/lib/harness/harness-outbound";

vi.mock("@/lib/harness/gateway-send", () => ({
  sendViaHarnessGateway: vi.fn(),
}));

const send = vi.mocked(sendViaHarnessGateway);

async function taskFixture() {
  const workspace = await db.workspace.create({ data: { name: `outbox-${crypto.randomUUID()}` } });
  const project = await db.project.create({
    data: { name: "Outbox project", workspaceId: workspace.id },
  });
  const task = await db.task.create({
    data: { title: "Ask owner", projectId: project.id, status: "IN_PROGRESS" },
  });
  const execution = await db.taskExecution.create({
    data: { taskId: task.id, status: "RUNNING" },
  });
  return { workspace, project, task, execution };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("durable harness outbound", () => {
  it("commits intent before send and atomically maps, opens, and parks after receipt", async () => {
    const fixture = await taskFixture();
    send.mockResolvedValue({
      ok: true,
      output: "sent",
      resolvedDest: "oc_takeoff",
      metadata: {
        platform: "feishu",
        chat_id: "oc_takeoff",
        message_id: "om_outbox_success",
        msg_type: "interactive",
      },
    });

    const result = await enqueueHarnessOutbound({
      taskId: fixture.task.id,
      gateway: "openclaw",
      downstream: "feishu",
      dest: "oc_takeoff",
      scope: "unattended",
      expectReply: true,
      message: "Please choose A or B. [[tower:task=test]]",
      dedupKey: "success",
    });

    expect(result).toMatchObject({
      state: "DELIVERED",
      sent: true,
      parked: true,
      platformMessageId: "om_outbox_success",
    });
    const outbound = await db.harnessOutbound.findUniqueOrThrow({
      where: { id: result.outboundId },
      include: { harnessMessage: true },
    });
    expect(outbound.harnessMessage.state).toBe("OPEN");
    expect(await db.taskExecution.findUniqueOrThrow({ where: { id: fixture.execution.id } }))
      .toMatchObject({ status: "PAUSED" });
    expect(await db.harnessDelivery.findUniqueOrThrow({
      where: { platformMessageId: "om_outbox_success" },
    })).toMatchObject({
      taskId: fixture.task.id,
      harnessMessageId: outbound.harnessMessageId,
      expectReply: true,
    });
  });

  it("keeps a failed send retryable without opening the ask or parking", async () => {
    const fixture = await taskFixture();
    send.mockResolvedValue({ ok: false, output: "gateway offline", resolvedDest: "oc_takeoff" });

    const result = await enqueueHarnessOutbound({
      taskId: fixture.task.id,
      gateway: "openclaw",
      downstream: "feishu",
      dest: "oc_takeoff",
      scope: "unattended",
      expectReply: true,
      message: "Need a decision",
      dedupKey: "failed",
    });

    expect(result).toMatchObject({ state: "FAILED", sent: false, parked: false });
    const outbound = await db.harnessOutbound.findUniqueOrThrow({
      where: { id: result.outboundId },
      include: { harnessMessage: true },
    });
    expect(outbound.harnessMessage.state).toBe("PENDING_DELIVERY");
    expect(await db.taskExecution.findUniqueOrThrow({ where: { id: fixture.execution.id } }))
      .toMatchObject({ status: "RUNNING" });
  });

  it("turns a stale in-flight send into SENT_UNVERIFIED instead of duplicating it", async () => {
    const fixture = await taskFixture();
    const message = await db.harnessMessage.create({
      data: {
        taskId: fixture.task.id,
        executionId: fixture.execution.id,
        kind: "ask",
        content: "Unknown platform outcome",
        state: "PENDING_DELIVERY",
      },
    });
    const outbound = await db.harnessOutbound.create({
      data: {
        dedupKey: `harness:${fixture.task.id}:stale`,
        taskId: fixture.task.id,
        executionId: fixture.execution.id,
        harnessMessageId: message.id,
        gateway: "openclaw",
        downstream: "feishu",
        dest: "oc_takeoff",
        scope: "unattended",
        expectReply: true,
        message: "Unknown platform outcome",
        state: "SENDING",
        attempts: 1,
        claimToken: "dead-sender",
        claimExpiresAt: new Date(Date.now() - 1),
      },
    });

    await expect(recoverHarnessOutbounds()).resolves.toMatchObject({ staleUnverified: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(await db.harnessOutbound.findUniqueOrThrow({ where: { id: outbound.id } }))
      .toMatchObject({
        state: "SENT_UNVERIFIED",
        claimToken: null,
        platformMessageId: null,
      });
    expect(await db.harnessMessage.findUniqueOrThrow({ where: { id: message.id } }))
      .toMatchObject({ state: "OPEN" });
    expect(await db.taskExecution.findUniqueOrThrow({ where: { id: fixture.execution.id } }))
      .toMatchObject({ status: "PAUSED" });
  });

  it("deduplicates a repeated logical send by stable caller key", async () => {
    const fixture = await taskFixture();
    send.mockResolvedValue({
      ok: true,
      output: "sent",
      resolvedDest: "oc_takeoff",
      metadata: { platform: "feishu", chat_id: "oc_takeoff", message_id: "om_dedup" },
    });
    const input = {
      taskId: fixture.task.id,
      gateway: "openclaw" as const,
      downstream: "feishu",
      dest: "oc_takeoff",
      scope: "work" as const,
      expectReply: false,
      message: "One notification",
      dedupKey: "logical-1",
    };
    const first = await enqueueHarnessOutbound(input);
    const second = await enqueueHarnessOutbound(input);

    expect(first.outboundId).toBe(second.outboundId);
    expect(second.deduped).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent implicit retries within one open ask lifecycle", async () => {
    const fixture = await taskFixture();
    send.mockResolvedValue({
      ok: true,
      output: "sent",
      resolvedDest: "oc_takeoff",
      metadata: { platform: "feishu", chat_id: "oc_takeoff", message_id: "om_concurrent" },
    });
    const input = {
      taskId: fixture.task.id,
      gateway: "openclaw" as const,
      downstream: "feishu",
      dest: "oc_takeoff",
      scope: "unattended" as const,
      expectReply: true,
      message: "One concurrent question",
    };

    const [first, second] = await Promise.all([
      enqueueHarnessOutbound(input),
      enqueueHarnessOutbound(input),
    ]);

    expect(first.outboundId).toBe(second.outboundId);
    expect([first.deduped, second.deduped]).toContain(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("starts a new implicit ask lifecycle after an identical prior ask was answered", async () => {
    const fixture = await taskFixture();
    send
      .mockResolvedValueOnce({
        ok: true,
        output: "sent",
        resolvedDest: "oc_takeoff",
        metadata: { platform: "feishu", chat_id: "oc_takeoff", message_id: "om_cycle_1" },
      })
      .mockResolvedValueOnce({
        ok: true,
        output: "sent",
        resolvedDest: "oc_takeoff",
        metadata: { platform: "feishu", chat_id: "oc_takeoff", message_id: "om_cycle_2" },
      });
    const input = {
      taskId: fixture.task.id,
      gateway: "openclaw" as const,
      downstream: "feishu",
      dest: "oc_takeoff",
      scope: "unattended" as const,
      expectReply: true,
      message: "Please confirm the same decision",
    };

    const first = await enqueueHarnessOutbound(input);
    const firstOutbound = await db.harnessOutbound.findUniqueOrThrow({
      where: { id: first.outboundId },
    });
    await db.$transaction([
      db.harnessMessage.update({
        where: { id: firstOutbound.harnessMessageId },
        data: { state: "ANSWERED", replyText: "yes", repliedAt: new Date() },
      }),
      db.taskExecution.update({
        where: { id: fixture.execution.id },
        data: { status: "RUNNING" },
      }),
    ]);

    const second = await enqueueHarnessOutbound(input);

    expect(second).toMatchObject({
      state: "DELIVERED",
      deduped: false,
      sent: true,
      parked: true,
      platformMessageId: "om_cycle_2",
    });
    expect(second.outboundId).not.toBe(first.outboundId);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await db.harnessOutbound.count({ where: { taskId: fixture.task.id } })).toBe(2);
  });

  it("reports an explicitly deduplicated answered ask as no longer parked", async () => {
    const fixture = await taskFixture();
    send.mockResolvedValue({
      ok: true,
      output: "sent",
      resolvedDest: "oc_takeoff",
      metadata: { platform: "feishu", chat_id: "oc_takeoff", message_id: "om_answered" },
    });
    const input = {
      taskId: fixture.task.id,
      gateway: "openclaw" as const,
      downstream: "feishu",
      dest: "oc_takeoff",
      scope: "unattended" as const,
      expectReply: true,
      message: "One logical decision",
      dedupKey: "decision-1",
    };
    const first = await enqueueHarnessOutbound(input);
    const outbound = await db.harnessOutbound.findUniqueOrThrow({
      where: { id: first.outboundId },
    });
    await db.harnessMessage.update({
      where: { id: outbound.harnessMessageId },
      data: { state: "ANSWERED", replyText: "done", repliedAt: new Date() },
    });

    const repeated = await enqueueHarnessOutbound(input);

    expect(repeated).toMatchObject({
      outboundId: first.outboundId,
      deduped: true,
      sent: true,
      parked: false,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
