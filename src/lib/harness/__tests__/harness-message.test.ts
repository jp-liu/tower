import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    harnessMessage: {
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
    taskExecution: { updateMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import {
  recordHarnessMessage,
  createAskMessage,
  getOpenAsk,
  getLatestAsk,
  answerOpenAsk,
  ignoreAsk,
  cancelOpenAsks,
  markNotifyStatus,
  sweepExpiredAsks,
} from "../harness-message";

const m = db as unknown as {
  harnessMessage: {
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  taskExecution: { updateMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

describe("recordHarnessMessage", () => {
  it("ask 出生即 OPEN", async () => {
    m.harnessMessage.create.mockResolvedValue({ id: "h1" });
    const { messageId } = await recordHarnessMessage({ taskId: "t1", kind: "ask", content: "Q" });
    expect(messageId).toBe("h1");
    expect(m.harnessMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "ask", state: "OPEN", notifyStatus: "PENDING", content: "Q" }),
    });
  });

  it("notify/done/failed 出生即 CLOSED", async () => {
    m.harnessMessage.create.mockResolvedValue({ id: "h2" });
    await recordHarnessMessage({ taskId: "t1", kind: "notify", content: "hi" });
    expect(m.harnessMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "notify", state: "CLOSED" }),
    });
  });
});

describe("createAskMessage", () => {
  it("先取消旧 OPEN ask（one-pending），再记录并 park RUNNING execution", async () => {
    m.harnessMessage.updateMany.mockResolvedValue({ count: 1 }); // cancelOpenAsks
    m.harnessMessage.create.mockResolvedValue({ id: "h3" });
    m.taskExecution.updateMany.mockResolvedValue({ count: 1 });

    const { messageId, execPaused } = await createAskMessage({
      taskId: "t1",
      executionId: "e1",
      question: "选 A 还是 B?",
    });
    expect(messageId).toBe("h3");
    expect(execPaused).toBe(true);
    // one-pending：先 cancel（OPEN ask → CANCELLED）
    expect(m.harnessMessage.updateMany).toHaveBeenCalledWith({
      where: { taskId: "t1", kind: "ask", state: "OPEN" },
      data: { state: "CANCELLED" },
    });
    expect(m.taskExecution.updateMany).toHaveBeenCalledWith({
      where: { taskId: "t1", status: "RUNNING" },
      data: { status: "PAUSED" },
    });
  });
});

describe("getOpenAsk / getLatestAsk", () => {
  it("getOpenAsk 查 kind=ask AND state=OPEN 最新", async () => {
    m.harnessMessage.findFirst.mockResolvedValue({ id: "h1", state: "OPEN" });
    const r = await getOpenAsk("t1");
    expect(r?.state).toBe("OPEN");
    expect(m.harnessMessage.findFirst).toHaveBeenCalledWith({
      where: { taskId: "t1", kind: "ask", state: "OPEN" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("getLatestAsk 查任意 state 的最新 ask", async () => {
    m.harnessMessage.findFirst.mockResolvedValue({ id: "h1", state: "ANSWERED" });
    await getLatestAsk("t1");
    expect(m.harnessMessage.findFirst).toHaveBeenCalledWith({
      where: { taskId: "t1", kind: "ask" },
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("answerOpenAsk (幂等)", () => {
  it("有 OPEN → updateMany 置 ANSWERED，count>0 返回该行", async () => {
    m.harnessMessage.updateMany.mockResolvedValue({ count: 1 });
    m.harnessMessage.findFirst.mockResolvedValue({ id: "h1", state: "ANSWERED", replyText: "选 A" });
    const r = await answerOpenAsk("t1", "选 A");
    expect(r?.state).toBe("ANSWERED");
    expect(m.harnessMessage.updateMany).toHaveBeenCalledWith({
      where: { taskId: "t1", kind: "ask", state: "OPEN" },
      data: expect.objectContaining({ state: "ANSWERED", replyText: "选 A" }),
    });
  });

  it("无 OPEN（并发第二次）→ count=0 返回 null", async () => {
    m.harnessMessage.updateMany.mockResolvedValue({ count: 0 });
    const r = await answerOpenAsk("t1", "选 A");
    expect(r).toBeNull();
  });
});

describe("ignoreAsk / cancelOpenAsks / markNotifyStatus / sweepExpiredAsks", () => {
  it("ignoreAsk 只把 OPEN 的那条转 IGNORED", async () => {
    m.harnessMessage.updateMany.mockResolvedValue({ count: 1 });
    await ignoreAsk("h1");
    expect(m.harnessMessage.updateMany).toHaveBeenCalledWith({
      where: { id: "h1", kind: "ask", state: "OPEN" },
      data: { state: "IGNORED" },
    });
  });

  it("cancelOpenAsks 返回取消数量", async () => {
    m.harnessMessage.updateMany.mockResolvedValue({ count: 2 });
    const n = await cancelOpenAsks("t1");
    expect(n).toBe(2);
  });

  it("markNotifyStatus 写 notifyStatus 及可选 sentAt/channel/targetRef", async () => {
    m.harnessMessage.update.mockResolvedValue({});
    await markNotifyStatus("h1", "SENT", { channel: "feishu", targetRef: '{"chatId":"oc"}' });
    expect(m.harnessMessage.update).toHaveBeenCalledWith({
      where: { id: "h1" },
      data: expect.objectContaining({ notifyStatus: "SENT", channel: "feishu", targetRef: '{"chatId":"oc"}' }),
    });
  });

  it("sweepExpiredAsks 把超期 OPEN ask 转 EXPIRED", async () => {
    m.harnessMessage.updateMany.mockResolvedValue({ count: 3 });
    const n = await sweepExpiredAsks(14);
    expect(n).toBe(3);
    const call = m.harnessMessage.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ kind: "ask", state: "OPEN" });
    expect(call.where.createdAt.lt).toBeInstanceOf(Date);
    expect(call.data).toEqual({ state: "EXPIRED" });
  });
});
