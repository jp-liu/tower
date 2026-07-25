// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getTowerDbFilePath } from "@/lib/tower-dir";
import { removeWorktree } from "@/lib/worktree";

// Mock next/cache to avoid "static generation store missing" error in test environment
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// Mock worktree module to avoid real git operations in tests
vi.mock("@/lib/worktree", () => ({
  removeWorktree: vi.fn(),
  createWorktree: vi.fn(),
}));

const testDb = new PrismaClient({
  datasourceUrl: `file:${getTowerDbFilePath()}`,
});

type TaskActionsModule = typeof import("@/actions/task-actions");

let createTaskFn: TaskActionsModule["createTask"];
let updateTaskFn: TaskActionsModule["updateTask"];
let updateTaskStatusFn: TaskActionsModule["updateTaskStatus"];

const mockedRemoveWorktree = vi.mocked(removeWorktree);

let workspaceId: string;
let projectId: string;

beforeAll(async () => {
  await testDb.$connect();

  // Dynamic import: task-actions.ts uses "use server" directive
  const mod = await import("@/actions/task-actions");
  createTaskFn = mod.createTask;
  updateTaskFn = mod.updateTask;
  updateTaskStatusFn = mod.updateTaskStatus;

  // Create workspace and project for tests
  const workspace = await testDb.workspace.create({
    data: { name: "Test Workspace for task-actions" },
  });
  workspaceId = workspace.id;

  const project = await testDb.project.create({
    data: { name: "Test Project for task-actions", workspaceId },
  });
  projectId = project.id;
});

afterAll(async () => {
  // Clean up test workspace (cascades to projects and tasks)
  await testDb.workspace.deleteMany({
    where: { name: "Test Workspace for task-actions" },
  });
  await testDb.$disconnect();
});

afterEach(async () => {
  // Clean up tasks after each test
  await testDb.task.deleteMany({ where: { projectId } });
});

describe("createTask with baseBranch", () => {
  it("persists baseBranch when provided", async () => {
    const task = await createTaskFn({
      title: "Test task with base branch",
      projectId,
      baseBranch: "main",
    });

    const found = await testDb.task.findUnique({ where: { id: task.id } });
    expect(found).not.toBeNull();
    expect(found!.baseBranch).toBe("main");
  });

  it("results in null baseBranch when not provided", async () => {
    const task = await createTaskFn({
      title: "Test task without base branch",
      projectId,
    });

    const found = await testDb.task.findUnique({ where: { id: task.id } });
    expect(found).not.toBeNull();
    expect(found!.baseBranch).toBeNull();
  });
});

describe("updateTask with baseBranch", () => {
  it("updates baseBranch field when provided", async () => {
    const task = await createTaskFn({
      title: "Task to update baseBranch",
      projectId,
    });

    await updateTaskFn(task.id, { baseBranch: "develop" });

    const found = await testDb.task.findUnique({ where: { id: task.id } });
    expect(found).not.toBeNull();
    expect(found!.baseBranch).toBe("develop");
  });
});

describe("updateTaskStatus CANCELLED cleanup", () => {
  afterEach(() => {
    mockedRemoveWorktree.mockReset();
  });

  it("calls removeWorktree when cancelling a task in a GIT project with localPath", async () => {
    // Create a GIT project with localPath
    const gitProject = await testDb.project.create({
      data: {
        name: "Git Project for cancel test",
        workspaceId,
        localPath: "/tmp/test-repo",
        gitUrl: "https://github.com/test/repo",
      },
    });
    const task = await createTaskFn({ title: "Task to cancel", projectId: gitProject.id });

    await updateTaskStatusFn(task.id, "CANCELLED");

    // Third arg is the recorded worktree branch; with no execution row it falls
    // back to the default `task/<taskId>` prefix (getRecordedWorktreeBranch).
    expect(mockedRemoveWorktree).toHaveBeenCalledWith(
      "/tmp/test-repo",
      task.id,
      `task/${task.id}`
    );

    // Cleanup
    await testDb.task.deleteMany({ where: { projectId: gitProject.id } });
    await testDb.project.delete({ where: { id: gitProject.id } });
  });

  it("does not call removeWorktree when cancelling a task in a NORMAL project", async () => {
    // projectId is a NORMAL project (no localPath)
    const task = await createTaskFn({ title: "Normal project task", projectId });

    mockedRemoveWorktree.mockClear();
    await updateTaskStatusFn(task.id, "CANCELLED");

    expect(mockedRemoveWorktree).not.toHaveBeenCalled();
  });

  it("does not throw when removeWorktree fails", async () => {
    const gitProject = await testDb.project.create({
      data: {
        name: "Git Project for cleanup fail test",
        workspaceId,
        localPath: "/tmp/test-repo-2",
        gitUrl: "https://github.com/test/repo2",
      },
    });
    const task = await createTaskFn({ title: "Task cleanup fail", projectId: gitProject.id });
    mockedRemoveWorktree.mockRejectedValueOnce(new Error("git error"));

    // Should not throw (D-05)
    await expect(updateTaskStatusFn(task.id, "CANCELLED")).resolves.toBeDefined();

    // Cleanup
    await testDb.task.deleteMany({ where: { projectId: gitProject.id } });
    await testDb.project.delete({ where: { id: gitProject.id } });
  });
});
