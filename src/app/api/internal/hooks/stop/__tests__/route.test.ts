import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  resetPtyLifecycleObserverForTests,
  setPtyLifecycleObserver,
} from "@/lib/pty/lifecycle";
import {
  hasWorkbenchDrainBoundary,
  markWorkbenchDrainBoundary,
  resetWorkbenchDrainBoundariesForTests,
} from "@/lib/workbench/boundary";

const mocks = vi.hoisted(() => ({
  broadcastNotification: vi.fn(),
  destroySession: vi.fn(),
  markSessionTurnComplete: vi.fn(() => true),
  providerTurnCompleted: vi.fn(),
  getOpenAsk: vi.fn(async (): Promise<{ content: string } | null> => null),
}));

vi.mock("@/lib/internal-api-guard", () => ({ requireLocalhost: () => null }));
vi.mock("@/lib/pty/ws-server", () => ({ broadcastNotification: mocks.broadcastNotification }));
vi.mock("@/lib/harness/harness-message", () => ({ getOpenAsk: mocks.getOpenAsk }));
vi.mock("@/lib/pty/session-store", () => ({
  destroySession: mocks.destroySession,
  markSessionTurnComplete: mocks.markSessionTurnComplete,
  getSession: vi.fn(() => undefined),
}));

const workspaceIds: string[] = [];

beforeEach(() => {
  setPtyLifecycleObserver({
    providerTurnCompleted: (taskId, turnKey) => {
      mocks.providerTurnCompleted(taskId, turnKey);
      markWorkbenchDrainBoundary(taskId);
    },
  });
});

afterEach(async () => {
  resetPtyLifecycleObserverForTests();
  resetWorkbenchDrainBoundariesForTests();
  await db.workspace.deleteMany({ where: { id: { in: workspaceIds.splice(0) } } });
  vi.clearAllMocks();
});

describe("POST /api/internal/hooks/stop", () => {
  it("creates the parent review event when the agent turn completes without closing the PTY", async () => {
    const workspace = await db.workspace.create({ data: { name: `stop-hook-${randomUUID()}` } });
    workspaceIds.push(workspace.id);
    const project = await db.project.create({
      data: { name: "Stop hook project", workspaceId: workspace.id, localPath: process.cwd() },
    });
    const parent = await db.task.create({ data: { title: "Parent", projectId: project.id } });
    const child = await db.task.create({
      data: { title: "Child", projectId: project.id, parentTaskId: parent.id, status: "IN_PROGRESS" },
    });
    const execution = await db.taskExecution.create({
      data: {
        taskId: child.id,
        status: "RUNNING",
        sessionId: "codex-thread-1",
        startedAt: new Date(),
      },
    });
    const { POST } = await import("../route");

    const body = JSON.stringify({
      taskId: child.id,
      executionId: execution.id,
      sessionId: "codex-thread-1",
      eventId: "codex-turn-1",
      lastReply: "Implemented and verified.",
    });
    const response = await POST(new NextRequest("http://localhost/api/internal/hooks/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.markSessionTurnComplete).toHaveBeenCalledWith(child.id);
    expect(mocks.destroySession).toHaveBeenCalledWith(child.id);
    expect(await db.taskExecution.findUnique({ where: { id: execution.id } }))
      .toMatchObject({ status: "COMPLETED", exitCode: 0, summary: "Implemented and verified." });
    expect(await db.task.findUnique({ where: { id: child.id } }))
      .toMatchObject({ status: "IN_REVIEW" });
    expect(await db.workbenchEvent.findFirst({ where: { sourceTaskId: child.id } })).toMatchObject({
      parentTaskId: parent.id,
      executionId: execution.id,
      kind: "CHILD_REVIEW_REQUIRED",
      state: "PENDING",
      dedupKey: expect.stringContaining("codex-turn-1"),
    });
    expect(hasWorkbenchDrainBoundary(child.id)).toBe(true);

    const retry = await POST(new NextRequest("http://localhost/api/internal/hooks/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }));
    expect(retry.status).toBe(200);
    expect(await db.workbenchEvent.count({ where: { sourceTaskId: child.id } })).toBe(1);
  });

  it("repairs a startup-orphaned execution when the stable Codex event arrives late", async () => {
    const workspace = await db.workspace.create({ data: { name: `late-stop-${randomUUID()}` } });
    workspaceIds.push(workspace.id);
    const project = await db.project.create({
      data: { name: "Late stop project", workspaceId: workspace.id, localPath: process.cwd() },
    });
    const parent = await db.task.create({ data: { title: "Parent", projectId: project.id } });
    const child = await db.task.create({
      data: { title: "Child", projectId: project.id, parentTaskId: parent.id, status: "IN_PROGRESS" },
    });
    const execution = await db.taskExecution.create({
      data: { taskId: child.id, status: "FAILED", startedAt: new Date(), endedAt: new Date() },
    });
    const staleFailure = await db.workbenchEvent.create({
      data: {
        parentTaskId: parent.id,
        sourceTaskId: child.id,
        executionId: execution.id,
        kind: "CHILD_EXECUTION_FAILED",
        priority: "HIGH",
        dedupKey: `child-exit:CHILD_EXECUTION_FAILED:${child.id}:${execution.id}`,
        payload: JSON.stringify({ childTaskId: child.id, executionId: execution.id }),
      },
    });
    const { POST } = await import("../route");
    const request = () => new NextRequest("http://localhost/api/internal/hooks/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: child.id,
        executionId: execution.id,
        sessionId: "codex-thread-late",
        eventId: "codex-turn-late",
        lastReply: "6662049",
      }),
    });
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await db.taskExecution.findUnique({ where: { id: execution.id } }))
      .toMatchObject({ status: "COMPLETED", exitCode: 0, summary: "6662049" });
    expect(await db.workbenchEvent.findUnique({ where: { id: staleFailure.id } }))
      .toMatchObject({ state: "CONSUMED" });
    expect(await db.workbenchEvent.count({
      where: { executionId: execution.id, kind: "CHILD_REVIEW_REQUIRED" },
    })).toBe(1);

    await db.workbenchEvent.update({
      where: { id: staleFailure.id },
      data: { state: "PENDING", consumedAt: null },
    });
    expect((await POST(request())).status).toBe(200);
    expect(await db.workbenchEvent.findUnique({ where: { id: staleFailure.id } }))
      .toMatchObject({ state: "CONSUMED" });
    expect(await db.workbenchEvent.count({
      where: { executionId: execution.id, kind: "CHILD_REVIEW_REQUIRED" },
    })).toBe(1);
  });

  it("does not apply an old durable completion boundary to a newer running execution", async () => {
    const workspace = await db.workspace.create({ data: { name: `stale-stop-${randomUUID()}` } });
    workspaceIds.push(workspace.id);
    const project = await db.project.create({
      data: { name: "Stale stop project", workspaceId: workspace.id, localPath: process.cwd() },
    });
    const parent = await db.task.create({ data: { title: "Parent", projectId: project.id } });
    const child = await db.task.create({
      data: { title: "Child", projectId: project.id, parentTaskId: parent.id, status: "IN_PROGRESS" },
    });
    const oldExecution = await db.taskExecution.create({
      data: { taskId: child.id, status: "FAILED", startedAt: new Date(), endedAt: new Date() },
    });
    const currentExecution = await db.taskExecution.create({
      data: { taskId: child.id, status: "RUNNING", startedAt: new Date() },
    });
    const { POST } = await import("../route");

    const response = await POST(new NextRequest("http://localhost/api/internal/hooks/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: child.id,
        executionId: oldExecution.id,
        eventId: "old-durable-turn",
        lastReply: "Old execution completed late.",
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.markSessionTurnComplete).not.toHaveBeenCalled();
    expect(mocks.providerTurnCompleted).not.toHaveBeenCalled();
    expect(mocks.destroySession).not.toHaveBeenCalled();
    expect(await db.taskExecution.findUnique({ where: { id: oldExecution.id } }))
      .toMatchObject({ status: "COMPLETED" });
    expect(await db.taskExecution.findUnique({ where: { id: currentExecution.id } }))
      .toMatchObject({ status: "RUNNING" });
    expect(await db.task.findUnique({ where: { id: child.id } }))
      .toMatchObject({ status: "IN_PROGRESS" });
  });

  it("parks a provider-confirmed paused execution without losing its boundary", async () => {
    const workspace = await db.workspace.create({ data: { name: `paused-stop-${randomUUID()}` } });
    workspaceIds.push(workspace.id);
    const project = await db.project.create({
      data: { name: "Paused stop project", workspaceId: workspace.id, localPath: process.cwd() },
    });
    const parent = await db.task.create({ data: { title: "Parent", projectId: project.id } });
    const child = await db.task.create({
      data: { title: "Child", projectId: project.id, parentTaskId: parent.id, status: "IN_PROGRESS" },
    });
    const execution = await db.taskExecution.create({
      data: { taskId: child.id, status: "PAUSED", startedAt: new Date() },
    });
    mocks.getOpenAsk.mockResolvedValueOnce({ content: "Choose a release target" });
    const { POST } = await import("../route");

    const response = await POST(new NextRequest("http://localhost/api/internal/hooks/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: child.id,
        executionId: execution.id,
        eventId: "paused-turn",
        lastReply: "Waiting for a decision.",
      }),
    }));

    expect(await response.json()).toEqual({ ok: true, parked: true });
    expect(mocks.markSessionTurnComplete).toHaveBeenCalledWith(child.id);
    expect(mocks.providerTurnCompleted).not.toHaveBeenCalled();
    expect(mocks.destroySession).toHaveBeenCalledWith(child.id);
    expect(await db.taskExecution.findUnique({ where: { id: execution.id } }))
      .toMatchObject({ status: "PAUSED" });
  });
});
