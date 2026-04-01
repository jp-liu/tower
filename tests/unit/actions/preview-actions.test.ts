// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFileSync: vi.fn(),
}));

// Mock preview-process-manager
vi.mock("@/lib/adapters/preview-process-manager", () => ({
  registerPreviewProcess: vi.fn(),
  killPreviewProcess: vi.fn(),
  isPreviewRunning: vi.fn(),
}));

// Mock config-reader
vi.mock("@/lib/config-reader", () => ({
  readConfigValue: vi.fn(),
}));

// Mock next/cache (required for "use server" actions)
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { spawn, execFileSync } from "node:child_process";
import {
  registerPreviewProcess,
  killPreviewProcess,
  isPreviewRunning,
} from "@/lib/adapters/preview-process-manager";
import { readConfigValue } from "@/lib/config-reader";
import { startPreview, stopPreview, openInTerminal } from "@/actions/preview-actions";

import type { ChildProcess } from "node:child_process";

const mockedSpawn = vi.mocked(spawn);
const mockedExecFileSync = vi.mocked(execFileSync);
const mockedRegisterPreviewProcess = vi.mocked(registerPreviewProcess);
const mockedKillPreviewProcess = vi.mocked(killPreviewProcess);
const mockedIsPreviewRunning = vi.mocked(isPreviewRunning);
const mockedReadConfigValue = vi.mocked(readConfigValue);

function makeFakeChild(): ChildProcess {
  return {
    killed: false,
    unref: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
  } as unknown as ChildProcess;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedReadConfigValue.mockResolvedValue("Terminal");
  mockedIsPreviewRunning.mockReturnValue(false);
  mockedKillPreviewProcess.mockReturnValue(false);
});

describe("startPreview", () => {
  it("spawns process with correct args and returns { started: true }", async () => {
    const fakeChild = makeFakeChild();
    mockedSpawn.mockReturnValue(fakeChild);

    const result = await startPreview("task-1", "pnpm dev", "/some/path");

    expect(mockedSpawn).toHaveBeenCalledWith("pnpm", ["dev"], {
      cwd: "/some/path",
      shell: false,
      detached: false,
      stdio: "ignore",
    });
    expect(mockedRegisterPreviewProcess).toHaveBeenCalledWith("task-1", fakeChild);
    expect(result).toEqual({ started: true });
  });

  it("calls unref() on the spawned child process", async () => {
    const fakeChild = makeFakeChild();
    mockedSpawn.mockReturnValue(fakeChild);

    await startPreview("task-1", "pnpm dev", "/some/path");

    expect(fakeChild.unref).toHaveBeenCalled();
  });

  it("handles single-word command (no args)", async () => {
    const fakeChild = makeFakeChild();
    mockedSpawn.mockReturnValue(fakeChild);

    await startPreview("task-1", "npm", "/some/path");

    expect(mockedSpawn).toHaveBeenCalledWith("npm", [], expect.any(Object));
  });

  it("handles multi-word command correctly", async () => {
    const fakeChild = makeFakeChild();
    mockedSpawn.mockReturnValue(fakeChild);

    await startPreview("task-1", "node server.js --port 3000", "/some/path");

    expect(mockedSpawn).toHaveBeenCalledWith(
      "node",
      ["server.js", "--port", "3000"],
      expect.any(Object)
    );
  });

  it("kills existing process first when already running", async () => {
    mockedIsPreviewRunning.mockReturnValue(true);
    const fakeChild = makeFakeChild();
    mockedSpawn.mockReturnValue(fakeChild);

    await startPreview("task-1", "pnpm dev", "/some/path");

    expect(mockedKillPreviewProcess).toHaveBeenCalledWith("task-1");
    expect(mockedSpawn).toHaveBeenCalled();
  });

  it("does NOT kill process when not already running", async () => {
    mockedIsPreviewRunning.mockReturnValue(false);
    const fakeChild = makeFakeChild();
    mockedSpawn.mockReturnValue(fakeChild);

    await startPreview("task-1", "pnpm dev", "/some/path");

    expect(mockedKillPreviewProcess).not.toHaveBeenCalled();
  });

  it("returns { started: false, error } when spawn throws", async () => {
    mockedSpawn.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = await startPreview("task-1", "pnpm dev", "/some/path");

    expect(result.started).toBe(false);
    expect(result.error).toContain("ENOENT");
  });
});

describe("stopPreview", () => {
  it("calls killPreviewProcess with the correct taskId", async () => {
    await stopPreview("task-1");
    expect(mockedKillPreviewProcess).toHaveBeenCalledWith("task-1");
  });

  it("returns undefined (void)", async () => {
    const result = await stopPreview("task-1");
    expect(result).toBeUndefined();
  });
});

describe("openInTerminal", () => {
  it("calls execFileSync with open, -a, terminal app, and path", async () => {
    mockedReadConfigValue.mockResolvedValue("Terminal");

    await openInTerminal("/some/worktree/path");

    expect(mockedExecFileSync).toHaveBeenCalledWith("open", [
      "-a",
      "Terminal",
      "/some/worktree/path",
    ]);
  });

  it("reads terminal app from readConfigValue", async () => {
    mockedReadConfigValue.mockResolvedValue("iTerm");

    await openInTerminal("/some/path");

    expect(mockedReadConfigValue).toHaveBeenCalledWith("terminal.app", "Terminal");
    expect(mockedExecFileSync).toHaveBeenCalledWith("open", ["-a", "iTerm", "/some/path"]);
  });

  it("uses default Terminal app when readConfigValue returns Terminal", async () => {
    mockedReadConfigValue.mockResolvedValue("Terminal");

    await openInTerminal("/another/path");

    expect(mockedExecFileSync).toHaveBeenCalledWith("open", [
      "-a",
      "Terminal",
      "/another/path",
    ]);
  });
});
