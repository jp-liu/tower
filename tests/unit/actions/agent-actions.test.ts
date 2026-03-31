// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

// Mock next/cache to avoid "static generation store missing" error in test environment
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const testDb = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" },
  },
});

let startTaskExecutionFn: (
  taskId: string,
  agent?: string,
  worktreePath?: string,
  worktreeBranch?: string
) => Promise<any>;

let workspaceId: string;
let projectId: string;
let taskId: string;

beforeAll(async () => {
  await testDb.$connect();

  // Dynamic import: agent-actions.ts uses "use server" directive
  const mod = await import("@/actions/agent-actions");
  startTaskExecutionFn = mod.startTaskExecution as any;

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
