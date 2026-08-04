import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the Stop hook API route: POST /api/internal/hooks/stop
 *
 * This route receives notifications from Claude's Stop hook (fired when
 * Claude finishes responding) and pushes them to a globalThis queue
 * consumed by the notification listener.
 */

// Mock the internal API guard
vi.mock("@/lib/internal-api-guard", () => ({
  requireLocalhost: vi.fn(() => null),
}));

const mockBroadcastNotification = vi.fn();
vi.mock("@/lib/pty/ws-server", () => ({
  broadcastNotification: mockBroadcastNotification,
}));

const mockDestroySession = vi.fn();
const mockMarkSessionTurnComplete = vi.fn();
vi.mock("@/lib/pty/session-store", () => ({
  destroySession: mockDestroySession,
  markSessionTurnComplete: mockMarkSessionTurnComplete,
}));

const mockNotifyProviderTurnCompleted = vi.fn();
vi.mock("@/lib/pty/lifecycle", () => ({
  notifyPtyProviderTurnCompleted: mockNotifyProviderTurnCompleted,
}));

const mockNotifyParent = vi.fn();
const mockNotifyParentDecision = vi.fn();
vi.mock("@/lib/derive/notify-parent", () => ({
  notifyParentOnChildStop: mockNotifyParent,
  notifyParentOnChildDecision: mockNotifyParentDecision,
}));

// Mock the db
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findUnique: vi.fn(),
    },
    taskExecution: {
      findFirst: vi.fn(),
    },
    // Harness park 分叉查询 OPEN ask（默认 undefined → 无 pending，走正常 fan-out 流程）
    harnessMessage: {
      findFirst: vi.fn(),
    },
  },
}));

describe("Stop hook API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should accept valid stop event with taskId and sessionId", async () => {
    const { db } = await import("@/lib/db");
    (db.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ctask123456789012345",
      title: "Test Task",
      projectId: "cproj1234567890123456",
      project: {
        name: "Test Project",
        workspaceId: "cws12345678901234567",
        workspace: { name: "Test Workspace" },
      },
    });
    (db.taskExecution.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "cexec12345678901234",
      status: "RUNNING",
    });

    const { POST } = await import("@/app/api/internal/hooks/stop/route");
    const request = new Request("http://localhost:3000/api/internal/hooks/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: "ctask123456789012345",
        executionId: "cexec12345678901234",
        sessionId: "test-session-123",
      }),
    });

    const response = await POST(request as never);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mockNotifyParent).toHaveBeenCalledOnce();
    expect(mockNotifyProviderTurnCompleted).toHaveBeenCalledWith(
      "ctask123456789012345",
      undefined,
      "cexec12345678901234",
    );
  });

  it("should reject request without taskId", async () => {
    const { POST } = await import("@/app/api/internal/hooks/stop/route");
    const request = new Request("http://localhost:3000/api/internal/hooks/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "test-session-123" }),
    });

    const response = await POST(request as never);
    expect(response.status).toBe(400);
  });

  it("should push event to globalThis queue", async () => {
    const { db } = await import("@/lib/db");
    (db.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ctask123456789012345",
      title: "Test Task",
      projectId: "cproj1234567890123456",
      project: {
        name: "Test Project",
        workspaceId: "cws12345678901234567",
        workspace: { name: "Test Workspace" },
      },
    });
    (db.taskExecution.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "cexec12345678901234",
      status: "RUNNING",
    });

    const { POST } = await import("@/app/api/internal/hooks/stop/route");
    const request = new Request("http://localhost:3000/api/internal/hooks/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: "ctask123456789012345",
        executionId: "cexec12345678901234",
        sessionId: "test-session-123",
      }),
    });

    await POST(request as never);

    expect(mockBroadcastNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "ctask123456789012345",
        type: "stop",
        projectName: "Test Project",
        workspaceName: "Test Workspace",
      })
    );
  });

  it("有 PENDING 请求时 park：destroySession 且不回推父任务", async () => {
    const { db } = await import("@/lib/db");
    (db.task.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ctask123456789012345",
      title: "Test Task",
      projectId: "cproj1234567890123456",
      project: {
        name: "Test Project",
        workspaceId: "cws12345678901234567",
        workspace: { name: "Test Workspace" },
      },
    });
    (db.taskExecution.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "cexec12345678901234",
      status: "RUNNING",
    });
    // 该任务有等待人回复的 OPEN ask → 走 park 分叉
    (db.harnessMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "creq12345678901234567",
      kind: "ask",
      state: "OPEN",
      content: "Which implementation should I use?",
    });

    const { POST } = await import("@/app/api/internal/hooks/stop/route");
    const request = new Request("http://localhost:3000/api/internal/hooks/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: "ctask123456789012345",
        executionId: "cexec12345678901234",
        sessionId: "s1",
      }),
    });

    const response = await POST(request as never);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.parked).toBe(true);
    expect(mockDestroySession).toHaveBeenCalledWith("ctask123456789012345");
    expect(mockNotifyParentDecision).toHaveBeenCalledWith(
      "ctask123456789012345",
      "Test Task",
      "",
      "Which implementation should I use?",
      { sessionId: "s1", eventId: undefined, executionId: "cexec12345678901234" },
    );
    // park 不是普通完成事件，也不能开放自动 drain 边界。
    expect(mockNotifyParent).not.toHaveBeenCalled();
    expect(mockNotifyProviderTurnCompleted).not.toHaveBeenCalled();
  });
});
