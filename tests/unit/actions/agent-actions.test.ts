// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getTowerDbFilePath } from "@/lib/tower-dir";

vi.mock("server-only", () => ({}));

// Mock next/cache to avoid "static generation store missing" error in test environment
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const testDb = new PrismaClient({
  datasourceUrl: `file:${getTowerDbFilePath()}`,
});

type AgentActionsModule = typeof import("@/actions/agent-actions");

let startTaskExecutionFn: AgentActionsModule["startTaskExecution"];

let workspaceId: string;
let projectId: string;
let taskId: string;

beforeAll(async () => {
  await testDb.$connect();

  // Dynamic import: agent-actions.ts uses "use server" directive
  const mod = await import("@/actions/agent-actions");
  startTaskExecutionFn = mod.startTaskExecution;

  // Create workspace, project, and task for tests
  const workspace = await testDb.workspace.create({
    data: { name: "Test Workspace for agent-actions" },
  });
  workspaceId = workspace.id;

  const project = await testDb.project.create({
    data: { name: "Test Project for agent-actions", workspaceId },
  });
  projectId = project.id;

  const task = await testDb.task.create({
    data: { title: "Test Task for agent-actions", projectId },
  });
  taskId = task.id;
});

afterAll(async () => {
  // Clean up test workspace (cascades to projects, tasks, executions)
  await testDb.workspace.deleteMany({
    where: { name: "Test Workspace for agent-actions" },
  });
  await testDb.$disconnect();
});

afterEach(async () => {
  // Clean up executions after each test
  await testDb.taskExecution.deleteMany({ where: { taskId } });
  // Reset task status back to TODO
  await testDb.task.update({ where: { id: taskId }, data: { status: "TODO" } });
});

let getActiveExecutionsFn: AgentActionsModule["getActiveExecutionsAcrossWorkspaces"];

describe("getActiveExecutionsAcrossWorkspaces", () => {
  beforeAll(async () => {
    const mod = await import("@/actions/agent-actions");
    getActiveExecutionsFn = mod.getActiveExecutionsAcrossWorkspaces;
  });

  it("returns empty array when no RUNNING executions exist", async () => {
    // Ensure no running executions
    await testDb.taskExecution.updateMany({
      where: { taskId, status: "RUNNING" },
      data: { status: "FAILED", endedAt: new Date() },
    });
    const result = await getActiveExecutionsFn();
    expect(Array.isArray(result)).toBe(true);
    expect(result.filter((execution) => execution.taskId === taskId)).toEqual([]);
  });

  it("returns RUNNING executions with full join chain", async () => {
    const execution = await testDb.taskExecution.create({
      data: {
        taskId,
        agent: "CLAUDE_CODE",
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    const result = await getActiveExecutionsFn();
    const found = result.find((candidate) => candidate.executionId === execution.id);
    expect(found).toBeDefined();
    if (!found) throw new Error("Expected the running execution in active results");
    expect(found).toMatchObject({
      executionId: execution.id,
      taskId,
      projectId,
      workspaceId,
    });
    expect(typeof found.taskTitle).toBe("string");
    expect(typeof found.projectName).toBe("string");
    expect(typeof found.workspaceName).toBe("string");

    // Cleanup
    await testDb.taskExecution.delete({ where: { id: execution.id } });
  });

  it("excludes COMPLETED and FAILED executions", async () => {
    const completed = await testDb.taskExecution.create({
      data: { taskId, agent: "CLAUDE_CODE", status: "COMPLETED", startedAt: new Date(), endedAt: new Date() },
    });
    const failed = await testDb.taskExecution.create({
      data: { taskId, agent: "CLAUDE_CODE", status: "FAILED", startedAt: new Date(), endedAt: new Date() },
    });

    const result = await getActiveExecutionsFn();
    const ids = result.map((execution) => execution.executionId);
    expect(ids).not.toContain(completed.id);
    expect(ids).not.toContain(failed.id);

    await testDb.taskExecution.deleteMany({ where: { id: { in: [completed.id, failed.id] } } });
  });

  it("does not attach a previous execution's STOPPED runtime to a new execution", async () => {
    await testDb.workbenchRuntime.upsert({
      where: { taskId },
      create: {
        taskId,
        executionId: "execution-old",
        state: "STOPPED",
        blockedReason: "Workbench terminal was stopped",
      },
      update: {
        executionId: "execution-old",
        state: "STOPPED",
        blockedReason: "Workbench terminal was stopped",
      },
    });
    const execution = await testDb.taskExecution.create({
      data: { taskId, agent: "CLAUDE_CODE", status: "RUNNING", startedAt: new Date() },
    });

    const result = await getActiveExecutionsFn();
    expect(result.find((candidate) => candidate.executionId === execution.id)?.workbenchRuntime)
      .toMatchObject({
        executionId: execution.id,
        runtimeExecutionId: "execution-old",
        syncState: "STALE",
        state: "STARTING",
        activeBatchId: null,
        blockedReason: null,
      });

    await testDb.workbenchRuntime.delete({ where: { taskId } });
    await testDb.taskExecution.delete({ where: { id: execution.id } });
  });
});

describe("startTaskExecution with worktree fields", () => {
  it("persists worktreePath and worktreeBranch when provided", async () => {
    const execution = await startTaskExecutionFn(
      taskId,
      "CLAUDE_CODE",
      "/tmp/wt",
      "task/abc123"
    );

    const found = await testDb.taskExecution.findUnique({
      where: { id: execution.id },
    });
    expect(found).not.toBeNull();
    expect(found!.worktreePath).toBe("/tmp/wt");
    expect(found!.worktreeBranch).toBe("task/abc123");
  });

  it("results in null for both worktree fields when not provided", async () => {
    const execution = await startTaskExecutionFn(taskId);

    const found = await testDb.taskExecution.findUnique({
      where: { id: execution.id },
    });
    expect(found).not.toBeNull();
    expect(found!.worktreePath).toBeNull();
    expect(found!.worktreeBranch).toBeNull();
  });
});
