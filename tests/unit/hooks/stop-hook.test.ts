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

// Mock the db
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findUnique: vi.fn(),
    },
    taskExecution: {
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

    const { POST } = await import("@/app/api/internal/hooks/stop/route");
    const request = new Request("http://localhost:3000/api/internal/hooks/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: "ctask123456789012345",
        sessionId: "test-session-123",
      }),
    });

    const response = await POST(request as never);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
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

    const { POST } = await import("@/app/api/internal/hooks/stop/route");
    const request = new Request("http://localhost:3000/api/internal/hooks/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: "ctask123456789012345",
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
});
