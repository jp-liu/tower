// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

// Mock next/cache to avoid "static generation store missing" error in test environment
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import {
  createProject,
  updateProject,
} from "@/actions/workspace-actions";
import { db } from "@/lib/db";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workspaceId: string;

beforeAll(async () => {
  const ws = await db.workspace.create({ data: { name: "preview-t1-ws" } });
  workspaceId = ws.id;
});

afterAll(async () => {
  await db.workspace.deleteMany({ where: { name: { startsWith: "preview-t1-ws" } } });
});

describe("createProject — preview preset detection (T1)", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  it("detects vite preset on create when localPath has package.json with vite", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preview-t1-vite-"));
    tmpDirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { vite: "^5.0.0" } })
    );

    const project = await createProject({
      name: "vite-test",
      localPath: dir,
      workspaceId,
    });

    const fresh = await db.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { previewPreset: true },
    });
    expect(fresh.previewPreset).toBe("vite");
  });

  it("leaves previewPreset null when localPath is empty directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preview-t1-empty-"));
    tmpDirs.push(dir);

    const project = await createProject({
      name: "empty-test",
      localPath: dir,
      workspaceId,
    });

    const fresh = await db.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { previewPreset: true },
    });
    expect(fresh.previewPreset).toBeNull();
  });

  it("does not throw when localPath does not exist (auto-created empty)", async () => {
    const dir = join(tmpdir(), `preview-t1-new-${Date.now()}`);
    tmpDirs.push(dir);

    const project = await createProject({
      name: "new-dir-test",
      localPath: dir,
      workspaceId,
    });

    const fresh = await db.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { previewPreset: true },
    });
    expect(fresh.previewPreset).toBeNull();
  });
});

describe("updateProject — preview preset detection on localPath change", () => {
  it("re-detects preset when localPath changes to a recognized project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preview-t1-update-"));
    writeFileSync(join(dir, "go.mod"), "module foo\ngo 1.21\n");
    const blankDir = mkdtempSync(join(tmpdir(), "preview-t1-blank-"));

    const project = await createProject({
      name: "update-test",
      localPath: blankDir,
      workspaceId,
    });
    expect(
      (await db.project.findUniqueOrThrow({ where: { id: project.id } })).previewPreset
    ).toBeNull();

    await updateProject(project.id, { localPath: dir });

    const fresh = await db.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { previewPreset: true },
    });
    expect(fresh.previewPreset).toBe("go-generic");

    rmSync(dir, { recursive: true, force: true });
    rmSync(blankDir, { recursive: true, force: true });
  });
});
