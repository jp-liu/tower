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

let createTaskFn: (data: {
  title: string;
  description?: string;
  projectId: string;
  priority?: string;
  status?: string;
  labelIds?: string[];
  baseBranch?: string;
}) => Promise<any>;
let updateTaskFn: (
  taskId: string,
  data: { title?: string; description?: string; priority?: string; labelIds?: string[]; baseBranch?: string }
) => Promise<any>;

let workspaceId: string;
let projectId: string;

beforeAll(async () => {
  await testDb.$connect();

  // Dynamic import: task-actions.ts uses "use server" directive
  const mod = await import("@/actions/task-actions");
  createTaskFn = mod.createTask as any;
  updateTaskFn = mod.updateTask as any;

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
