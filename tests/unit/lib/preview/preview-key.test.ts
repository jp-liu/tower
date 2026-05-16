import { describe, it, expect } from "vitest";
import {
  getPreviewKey,
  getPreviewCwd,
  getEffectiveCommand,
  getEffectivePort,
} from "@/lib/preview/preview-key";

describe("getPreviewKey", () => {
  it("combines cwd + command + port into key string", () => {
    const k = getPreviewKey({
      cwd: "/repo/h5",
      command: "pnpm dev",
      port: 5173,
    });
    expect(k).toBe("/repo/h5|pnpm dev|5173");
  });

  it("identical effective tuples produce identical keys", () => {
    const a = getPreviewKey({ cwd: "/r", command: "x", port: 1 });
    const b = getPreviewKey({ cwd: "/r", command: "x", port: 1 });
    expect(a).toBe(b);
  });

  it("different cwd produces different keys", () => {
    const a = getPreviewKey({ cwd: "/r/h5", command: "pnpm dev", port: 5173 });
    const b = getPreviewKey({ cwd: "/r/web", command: "pnpm dev", port: 5173 });
    expect(a).not.toBe(b);
  });
});

describe("getPreviewCwd", () => {
  it("returns worktreePath when present", () => {
    expect(
      getPreviewCwd({
        worktreePath: "/wt/abc",
        projectLocalPath: "/repo",
        subPath: null,
      })
    ).toBe("/wt/abc");
  });

  it("returns projectLocalPath + subPath when no worktree", () => {
    expect(
      getPreviewCwd({
        worktreePath: null,
        projectLocalPath: "/repo",
        subPath: "apps/h5",
      })
    ).toBe("/repo/apps/h5");
  });

  it("returns projectLocalPath when no worktree and no subPath", () => {
    expect(
      getPreviewCwd({
        worktreePath: null,
        projectLocalPath: "/repo",
        subPath: null,
      })
    ).toBe("/repo");
  });

  it("returns null when both worktree and projectLocalPath are null", () => {
    expect(
      getPreviewCwd({
        worktreePath: null,
        projectLocalPath: null,
        subPath: null,
      })
    ).toBeNull();
  });

  it("worktree overrides subPath (worktree wins)", () => {
    expect(
      getPreviewCwd({
        worktreePath: "/wt/abc",
        projectLocalPath: "/repo",
        subPath: "apps/h5",
      })
    ).toBe("/wt/abc");
  });
});

describe("getEffectiveCommand", () => {
  it("task override wins", () => {
    expect(
      getEffectiveCommand({
        taskOverride: "task-cmd",
        projectDefault: "proj-cmd",
        presetCommand: "preset-cmd",
      })
    ).toBe("task-cmd");
  });

  it("project default used when task is null", () => {
    expect(
      getEffectiveCommand({
        taskOverride: null,
        projectDefault: "proj-cmd",
        presetCommand: "preset-cmd",
      })
    ).toBe("proj-cmd");
  });

  it("preset command used when both null", () => {
    expect(
      getEffectiveCommand({
        taskOverride: null,
        projectDefault: null,
        presetCommand: "preset-cmd",
      })
    ).toBe("preset-cmd");
  });

  it("empty string when all null", () => {
    expect(
      getEffectiveCommand({
        taskOverride: null,
        projectDefault: null,
        presetCommand: null,
      })
    ).toBe("");
  });
});

describe("getEffectivePort", () => {
  it("task override wins; falls back to project then preset then 0", () => {
    expect(
      getEffectivePort({ taskOverride: 1, projectDefault: 2, presetPort: 3 })
    ).toBe(1);
    expect(
      getEffectivePort({
        taskOverride: null,
        projectDefault: 2,
        presetPort: 3,
      })
    ).toBe(2);
    expect(
      getEffectivePort({
        taskOverride: null,
        projectDefault: null,
        presetPort: 3,
      })
    ).toBe(3);
    expect(
      getEffectivePort({
        taskOverride: null,
        projectDefault: null,
        presetPort: null,
      })
    ).toBe(0);
  });
});
