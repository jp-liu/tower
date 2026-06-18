import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { fs, execFileSync } = vi.hoisted(() => ({
  fs: {
    mkdir: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    unlink: vi.fn(),
    writeFile: vi.fn(),
  },
  execFileSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ ...fs, default: fs }));
vi.mock("node:child_process", () => ({ execFileSync, default: { execFileSync } }));

import { reapOrphanedProcesses } from "@/lib/pty/orphan-reaper";

describe("reapOrphanedProcesses", () => {
  const realPlatform = process.platform;
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, "platform", { value: "linux" });
    // process.kill(pid, 0) → liveness probe; default: alive. Group kills no-op.
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    fs.unlink.mockResolvedValue(undefined);
  });

  afterEach(() => {
    killSpy.mockRestore();
    Object.defineProperty(process, "platform", { value: realPlatform });
  });

  it("returns 0 when the signal dir does not exist", async () => {
    fs.readdir.mockRejectedValue(new Error("ENOENT"));
    expect(await reapOrphanedProcesses()).toBe(0);
  });

  it("group-kills a live process whose command is a Tower CLI", async () => {
    fs.readdir.mockResolvedValue(["pid-task1", "exit-task1"]);
    fs.readFile.mockResolvedValue("4242");
    execFileSync.mockReturnValue("/Users/x/.local/bin/claude --dangerously-skip-permissions\n");

    const killed = await reapOrphanedProcesses();

    expect(killed).toBe(1);
    expect(killSpy).toHaveBeenCalledWith(-4242, "SIGKILL");
    // pid file always dropped; non-pid file ignored
    expect(fs.unlink).toHaveBeenCalledTimes(1);
    expect(fs.unlink.mock.calls[0][0]).toContain("pid-task1");
  });

  it("does NOT kill a dead pid but still clears the file", async () => {
    fs.readdir.mockResolvedValue(["pid-task1"]);
    fs.readFile.mockResolvedValue("4242");
    killSpy.mockImplementation((_pid: number, sig?: string | number) => {
      if (sig === 0) {
        const e = new Error("ESRCH") as NodeJS.ErrnoException;
        e.code = "ESRCH";
        throw e;
      }
      return true;
    });

    const killed = await reapOrphanedProcesses();

    expect(killed).toBe(0);
    expect(killSpy).not.toHaveBeenCalledWith(-4242, "SIGKILL");
    expect(execFileSync).not.toHaveBeenCalled(); // short-circuits before identity check
    expect(fs.unlink).toHaveBeenCalledTimes(1);
  });

  it("does NOT kill a live process that is not a Tower CLI (pid reuse guard)", async () => {
    fs.readdir.mockResolvedValue(["pid-task1"]);
    fs.readFile.mockResolvedValue("4242");
    execFileSync.mockReturnValue("/usr/bin/vim notes.txt\n");

    const killed = await reapOrphanedProcesses();

    expect(killed).toBe(0);
    expect(killSpy).not.toHaveBeenCalledWith(-4242, "SIGKILL");
    expect(fs.unlink).toHaveBeenCalledTimes(1);
  });

  it("fails closed when ps cannot identify the process", async () => {
    fs.readdir.mockResolvedValue(["pid-task1"]);
    fs.readFile.mockResolvedValue("4242");
    execFileSync.mockImplementation(() => {
      throw new Error("ps failed");
    });

    const killed = await reapOrphanedProcesses();

    expect(killed).toBe(0);
    expect(killSpy).not.toHaveBeenCalledWith(-4242, "SIGKILL");
  });

  it("ignores invalid pids (<=1) and non-pid files", async () => {
    fs.readdir.mockResolvedValue(["pid-bad", "other-file"]);
    fs.readFile.mockResolvedValue("1");

    const killed = await reapOrphanedProcesses();

    expect(killed).toBe(0);
    expect(execFileSync).not.toHaveBeenCalled();
    // only the pid- file is read+unlinked
    expect(fs.unlink).toHaveBeenCalledTimes(1);
  });
});
