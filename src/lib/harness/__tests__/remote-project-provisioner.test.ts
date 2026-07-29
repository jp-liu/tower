import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import {
  getRemoteProjectProvisionStatus,
  provisionRemoteProject,
  setRemoteProjectAccessMode,
} from "../remote-project-provisioner";

let workspaceId: string;
let localRoot: string;

beforeEach(async () => {
  const workspace = await db.workspace.create({ data: { name: `remote-project-${Date.now()}` } });
  workspaceId = workspace.id;
  localRoot = await mkdtemp(path.join(os.tmpdir(), "tower-remote-project-"));
});

afterEach(async () => {
  await db.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  await rm(localRoot, { recursive: true, force: true });
});

describe("remote project provisioner", () => {
  it("asks for workspace and local root instead of guessing", async () => {
    const result = await provisionRemoteProject({ gitUrl: "https://example.com/acme/repo.git" });

    expect(result).toEqual({
      needsInput: true,
      missing: ["workspaceId", "localRoot"],
      message: "Please provide workspaceId, localRoot. Tower will not guess the workspace or local root.",
    });
  });

  it("clones once, registers REVIEW_ONLY, creates a Workbench, and upgrades only explicitly", async () => {
    const cloneRepository = vi.fn(async (_url: string, targetPath: string) => {
      await mkdir(targetPath, { recursive: true });
      await writeFile(path.join(targetPath, "README.md"), "# Remote project\n", "utf-8");
    });
    const input = {
      gitUrl: "https://example.com/acme/repo.git",
      workspaceId,
      localRoot,
    };

    const first = await provisionRemoteProject(input, { cloneRepository });
    expect(first).toMatchObject({
      ok: true,
      deduped: false,
      cloned: true,
      project: {
        name: "repo",
        accessMode: "REVIEW_ONLY",
        workspaceId,
      },
      workbenchTaskId: expect.any(String),
    });
    expect(cloneRepository).toHaveBeenCalledTimes(1);
    if (!first.project) throw new Error("Expected a provisioned project");

    const duplicate = await provisionRemoteProject(input, { cloneRepository });
    expect(duplicate).toMatchObject({
      ok: true,
      deduped: true,
      cloned: false,
      project: { id: first.project.id },
    });
    expect(cloneRepository).toHaveBeenCalledTimes(1);

    await setRemoteProjectAccessMode(first.project.id, "FULL_WORK");
    const status = await getRemoteProjectProvisionStatus(first.project.id);
    expect(status).toMatchObject({
      project: { id: first.project.id, accessMode: "FULL_WORK" },
      workbench: { id: first.workbenchTaskId },
    });
  });

  it("rejects provisioning directly into FULL_WORK mode", async () => {
    await expect(provisionRemoteProject({
      gitUrl: "https://example.com/acme/unsafe.git",
      workspaceId,
      localRoot,
      accessMode: "FULL_WORK",
    })).rejects.toThrow("REVIEW_ONLY first");
  });

  it("deduplicates concurrent registrations by normalized repository identity", async () => {
    const cloneRepository = vi.fn(async (_url: string, targetPath: string) => {
      await mkdir(targetPath, { recursive: true });
      await writeFile(path.join(targetPath, "README.md"), "# Concurrent\n", "utf-8");
    });
    const otherRoot = await mkdtemp(path.join(os.tmpdir(), "tower-remote-project-other-"));
    try {
      const [first, second] = await Promise.all([
        provisionRemoteProject({
          gitUrl: "https://example.com/acme/concurrent.git",
          workspaceId,
          localRoot,
        }, { cloneRepository }),
        provisionRemoteProject({
          gitUrl: "git@example.com:acme/concurrent.git",
          workspaceId,
          localRoot: otherRoot,
        }, { cloneRepository }),
      ]);
      expect(first.project?.id).toBe(second.project?.id);
      expect([first.deduped, second.deduped]).toContain(true);
      expect(await db.project.count({
        where: { repositoryKey: "example.com/acme/concurrent" },
      })).toBe(1);
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }
  });
});
