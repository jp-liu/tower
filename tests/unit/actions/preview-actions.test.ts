import { describe, it, expect, afterAll, beforeAll, afterEach } from "vitest";
import {
  getPreviewState,
  startPreview,
} from "@/actions/preview-actions";
import { destroyAllPreviewSessions } from "@/lib/preview/session-store";
import { db } from "@/lib/db";

let workspaceId: string;
let projectId: string;
let taskId: string;

beforeAll(async () => {
  const ws = await db.workspace.create({ data: { name: "preview-test-ws-2.5" } });
  workspaceId = ws.id;
  const proj = await db.project.create({
    data: {
      name: "preview-test-proj-2.5",
      type: "NORMAL",
      localPath: process.cwd(),
      workspaceId,
      previewPreset: null,
    },
  });
  projectId = proj.id;
  const task = await db.task.create({
    data: { title: "preview-test-task-2.5", projectId },
  });
  taskId = task.id;
});

afterAll(async () => {
  // cascade delete workspace → projects → tasks
  await db.workspace.deleteMany({ where: { name: { startsWith: "preview-test-ws-2.5" } } });
});

afterEach(() => {
  destroyAllPreviewSessions();
});

describe("getPreviewState", () => {
  it("returns stopped state for new task", async () => {
    const s = await getPreviewState({
      taskId,
      projectId,
      worktreePath: null,
    });
    expect(s.status).toBe("stopped");
    expect(s.previewKey).toBeTruthy();
    expect(s.activeSubscribers).toBe(0);
  });

  it("computes effective command from preset when project/task null", async () => {
    await db.project.update({
      where: { id: projectId },
      data: { previewPreset: "vite", previewCommand: null },
    });
    const s = await getPreviewState({
      taskId,
      projectId,
      worktreePath: null,
    });
    expect(s.command).toBe("pnpm dev");
    expect(s.port).toBe(5173);
  });

  it("task override takes precedence", async () => {
    await db.task.update({
      where: { id: taskId },
      data: { previewCommandOverride: "pnpm dev:full", previewPortOverride: 6173 },
    });
    const s = await getPreviewState({
      taskId,
      projectId,
      worktreePath: null,
    });
    expect(s.command).toBe("pnpm dev:full");
    expect(s.port).toBe(6173);
  });

  it("exposes source layers and fallback defaults", async () => {
    // task override active for both layers (from previous test) — keep preset=vite
    const s1 = await getPreviewState({
      taskId,
      projectId,
      worktreePath: null,
    });
    expect(s1.commandSource).toBe("task");
    expect(s1.portSource).toBe("task");
    expect(s1.projectDefaultCommand).toBeNull();
    expect(s1.projectDefaultPort).toBeNull();
    expect(s1.presetCommand).toBe("pnpm dev");
    expect(s1.presetPort).toBe(5173);

    // Clear task override, set project default for command only
    await db.task.update({
      where: { id: taskId },
      data: { previewCommandOverride: null, previewPortOverride: null },
    });
    await db.project.update({
      where: { id: projectId },
      data: { previewCommand: "pnpm start", previewPort: null },
    });
    const s2 = await getPreviewState({
      taskId,
      projectId,
      worktreePath: null,
    });
    expect(s2.command).toBe("pnpm start");
    expect(s2.commandSource).toBe("project");
    expect(s2.port).toBe(5173);
    expect(s2.portSource).toBe("preset");
    expect(s2.projectDefaultCommand).toBe("pnpm start");
    expect(s2.projectDefaultPort).toBeNull();

    // Reset project layer to leave only preset
    await db.project.update({
      where: { id: projectId },
      data: { previewCommand: null, previewPort: null },
    });
    const s3 = await getPreviewState({
      taskId,
      projectId,
      worktreePath: null,
    });
    expect(s3.commandSource).toBe("preset");
    expect(s3.portSource).toBe("preset");
  });
});

describe("startPreview", () => {
  it("returns error when port is in use", async () => {
    const http = await import("node:http");
    const blocker = http.createServer().listen(19988);
    await new Promise((r) => blocker.once("listening", r));

    await db.task.update({
      where: { id: taskId },
      data: { previewCommandOverride: "node", previewPortOverride: 19988 },
    });

    const r = await startPreview({ taskId, projectId, worktreePath: null });
    expect(r.started).toBe(false);
    expect(r.error).toMatch(/in use/i);

    await new Promise((r) => blocker.close(r));
  });
});
