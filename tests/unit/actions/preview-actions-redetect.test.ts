// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";
import { redetectPreset } from "@/actions/preview-actions";
import { db } from "@/lib/db";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

afterAll(async () => {
  await db.workspace.deleteMany({ where: { name: { startsWith: "preview-t3-" } } });
});

describe("redetectPreset", () => {
  it("overwrites existing previewPreset with fresh detection", async () => {
    const ws = await db.workspace.create({ data: { name: "preview-t3-ws" } });
    const dir = mkdtempSync(join(tmpdir(), "preview-t3-"));
    writeFileSync(join(dir, "manage.py"), "import django");

    const proj = await db.project.create({
      data: {
        name: "preview-t3-proj",
        type: "NORMAL",
        localPath: dir,
        workspaceId: ws.id,
        previewPreset: "vite",
      },
    });

    const r = await redetectPreset({ projectId: proj.id });
    expect(r.preset).toBe("django");

    const fresh = await db.project.findUniqueOrThrow({
      where: { id: proj.id },
      select: { previewPreset: true },
    });
    expect(fresh.previewPreset).toBe("django");

    rmSync(dir, { recursive: true, force: true });
  });

  it("sets previewPreset to null when nothing matches", async () => {
    const ws = await db.workspace.create({ data: { name: "preview-t3-null-ws" } });
    const dir = mkdtempSync(join(tmpdir(), "preview-t3-null-"));

    const proj = await db.project.create({
      data: {
        name: "preview-t3-null-proj",
        type: "NORMAL",
        localPath: dir,
        workspaceId: ws.id,
        previewPreset: "vite",
      },
    });

    const r = await redetectPreset({ projectId: proj.id });
    expect(r.preset).toBeNull();

    const fresh = await db.project.findUniqueOrThrow({
      where: { id: proj.id },
      select: { previewPreset: true },
    });
    expect(fresh.previewPreset).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });
});
