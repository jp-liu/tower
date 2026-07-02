import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock db before importing the module under test — project convention.
vi.mock("@/lib/db", () => ({
  db: {
    humanInputRequest: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    taskExecution: {
      updateMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import {
  createHumanInputRequest,
  getPendingRequest,
  answerHumanInputRequest,
} from "../human-input";

const mockDb = db as unknown as {
  humanInputRequest: {
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  taskExecution: { updateMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("human-input", () => {
  it("createHumanInputRequest 落 PENDING 记录并把 RUNNING execution 置 PAUSED", async () => {
    mockDb.humanInputRequest.create.mockResolvedValue({ id: "req_1" });
    mockDb.taskExecution.updateMany.mockResolvedValue({ count: 1 });

    const { requestId, execPaused } = await createHumanInputRequest({
      taskId: "task_1",
      executionId: "exec_1",
      question: "选 A 还是 B?",
    });

    expect(requestId).toBe("req_1");
    expect(execPaused).toBe(true);
    // 只把该任务 RUNNING 的 execution 置 PAUSED（onExit guard 靠此跳过 finalize）
    expect(mockDb.taskExecution.updateMany).toHaveBeenCalledWith({
      where: { taskId: "task_1", status: "RUNNING" },
      data: { status: "PAUSED" },
    });
    expect(mockDb.humanInputRequest.create).toHaveBeenCalledWith({
      data: { taskId: "task_1", executionId: "exec_1", question: "选 A 还是 B?" },
    });
  });

  it("createHumanInputRequest 无 RUNNING execution 时 execPaused 为 false", async () => {
    mockDb.humanInputRequest.create.mockResolvedValue({ id: "req_2" });
    mockDb.taskExecution.updateMany.mockResolvedValue({ count: 0 });

    const { execPaused } = await createHumanInputRequest({
      taskId: "task_1",
      question: "无 exec",
    });
    expect(execPaused).toBe(false);
    // executionId 缺省时写 null
    expect(mockDb.humanInputRequest.create).toHaveBeenCalledWith({
      data: { taskId: "task_1", executionId: null, question: "无 exec" },
    });
  });

  it("getPendingRequest 只查最新的 PENDING", async () => {
    mockDb.humanInputRequest.findFirst.mockResolvedValue({ id: "req_1", status: "PENDING" });
    const p = await getPendingRequest("task_1");
    expect(p?.status).toBe("PENDING");
    expect(mockDb.humanInputRequest.findFirst).toHaveBeenCalledWith({
      where: { taskId: "task_1", status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("answerHumanInputRequest 写 answer 并转 ANSWERED", async () => {
    mockDb.humanInputRequest.findFirst.mockResolvedValue({ id: "req_1", status: "PENDING" });
    mockDb.humanInputRequest.update.mockResolvedValue({
      id: "req_1",
      status: "ANSWERED",
      answer: "选 A",
    });

    const req = await answerHumanInputRequest("task_1", "选 A");
    expect(req?.status).toBe("ANSWERED");
    expect(req?.answer).toBe("选 A");
    expect(mockDb.humanInputRequest.update).toHaveBeenCalledWith({
      where: { id: "req_1" },
      data: expect.objectContaining({ status: "ANSWERED", answer: "选 A" }),
    });
  });

  it("answerHumanInputRequest 无 PENDING 时返回 null，不调 update", async () => {
    mockDb.humanInputRequest.findFirst.mockResolvedValue(null);
    const req = await answerHumanInputRequest("task_1", "选 A");
    expect(req).toBeNull();
    expect(mockDb.humanInputRequest.update).not.toHaveBeenCalled();
  });
});
