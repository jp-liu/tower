// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";
import { getPreviewState } from "@/actions/preview-actions";
import { db } from "@/lib/db";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

afterAll(async () => {
  await db.workspace.deleteMany({ where: { name: { startsWith: "preview-t2-" } } });
});

describe("T2 fallback detection in getPreviewState", () => {
  it("auto-detects and writes previewPreset when null", async () => {
    const ws = await db.workspace.create({ data: { name: "preview-t2-ws" } });
    const dir = mkdtempSync(join(tmpdir(), "preview-t2-"));
    writeFileSync(join(dir, "go.mod"), "module foo");

    const proj = await db.project.create({
      data: {
        name: "preview-t2-proj",
        type: "NORMAL",
        localPath: dir,
        workspaceId: ws.id,
        previewPreset: null,
      },
    });
    const task = await db.task.create({ data: { title: "t", projectId: proj.id } });

    await getPreviewState({
      taskId: task.id,
      projectId: proj.id,
      worktreePath: null,
    });

    await new Promise((r) => setTimeout(r, 500));

    const fresh = await db.project.findUniqueOrThrow({
      where: { id: proj.id },
      select: { previewPreset: true },
    });
    expect(fresh.previewPreset).toBe("go-generic");

    rmSync(dir, { recursive: true, force: true });
  });

  it("does not overwrite existing previewPreset (conditional update)", async () => {
    const ws = await db.workspace.create({ data: { name: "preview-t2-skip-ws" } });
    const dir = mkdtempSync(join(tmpdir(), "preview-t2-skip-"));
    writeFileSync(join(dir, "go.mod"), "module foo");

    const proj = await db.project.create({
      data: {
        name: "preview-t2-skip-proj",
        type: "NORMAL",
        localPath: dir,
        workspaceId: ws.id,
        previewPreset: "static",
      },
    });
    const task = await db.task.create({ data: { title: "t", projectId: proj.id } });

    await getPreviewState({
      taskId: task.id,
      projectId: proj.id,
      worktreePath: null,
    });
    await new Promise((r) => setTimeout(r, 500));

    const fresh = await db.project.findUniqueOrThrow({
      where: { id: proj.id },
      select: { previewPreset: true },
    });
    expect(fresh.previewPreset).toBe("static");

    rmSync(dir, { recursive: true, force: true });
  });
});
