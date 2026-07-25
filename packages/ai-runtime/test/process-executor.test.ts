import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { ControlledProcessExecutor, prepareSpawnTarget } from "../src/index.js";

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly pid = 4242;
  readonly kill = vi.fn(() => true);
}

function fakeSpawn(child: FakeChild, run?: () => void) {
  return vi.fn(() => {
    queueMicrotask(() => run?.());
    return child;
  });
}

describe("ControlledProcessExecutor stream", () => {
  it("uses shell:false and preserves split UTF-8 in execute aggregation", async () => {
    const child = new FakeChild();
    const bytes = Buffer.from("你好");
    const spawn = fakeSpawn(child, () => {
      child.stdout.write(bytes.subarray(0, 2));
      child.stdout.write(bytes.subarray(2));
      child.stderr.write("warning");
      child.emit("close", 0, null);
    });
    const result = await new ControlledProcessExecutor({ spawn: spawn as never }).execute({
      command: "/bin/provider", args: ["--json"], initialInput: "prompt",
    });

    expect(result).toMatchObject({ exitCode: 0, stdout: "你好", stderr: "warning" });
    expect(spawn).toHaveBeenCalledWith("/bin/provider", ["--json"], expect.objectContaining({
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    }));
  });

  it.each([
    ["cancel", "PROCESS_CANCELLED"],
    ["timeout", "PROCESS_TIMEOUT"],
    ["limit", "PROCESS_OUTPUT_LIMIT"],
  ] as const)("stops the full process tree for %s and returns a safe error", async (mode, code) => {
    const child = new FakeChild();
    const controller = new AbortController();
    const killTree = vi.fn(() => queueMicrotask(() => child.emit("close", null, "SIGTERM")));
    const spawn = fakeSpawn(child, () => {
      if (mode === "limit") child.stdout.write("too much output");
      else if (mode === "cancel") controller.abort();
    });
    const executor = new ControlledProcessExecutor({ spawn: spawn as never, killTree });
    await expect(executor.execute(
      { command: "/bin/provider", args: [] },
      {
        signal: controller.signal,
        ...(mode === "timeout" ? { timeoutMs: 1 } : {}),
        ...(mode === "limit" ? { maxOutputBytes: 4 } : {}),
      },
    )).rejects.toMatchObject({ code });
    expect(killTree).toHaveBeenCalledWith(child, "SIGTERM");
  });

  it("resolves Windows npm shims to node without a shell", async () => {
    const target = await prepareSpawnTarget(
      "C:\\Users\\test\\AppData\\Roaming\\npm\\tool.cmd",
      ["--json"],
      "win32",
      { ComSpec: "cmd.exe" },
      {
        readFile: async () => '@"%~dp0\\node.exe" "%~dp0\\node_modules\\tool\\cli.js" %*',
        exists: async (candidate) => candidate.endsWith("cli.js"),
        nodeExecutable: "C:\\node.exe",
      },
    );
    expect(target).toEqual({
      command: "C:\\node.exe",
      args: ["C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\tool\\cli.js", "--json"],
    });
  });
});
