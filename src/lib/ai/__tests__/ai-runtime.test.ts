// @vitest-environment node
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CliPluginError, type CliProcessExecutor } from "@tower/ai-sdk";
import {
  CommandResolver,
  ControlledProcessExecutor,
  defaultSupplementalPaths,
  parseWindowsNpmShim,
  prepareSpawnTarget,
  redactProcessDiagnostic,
} from "@tower/ai-runtime";

const success = (stdout = "tool 1.0.0") => ({
  exitCode: 0,
  signal: null,
  stdout,
  stderr: "",
  durationMs: 1,
});

describe("CommandResolver", () => {
  it("returns every attempted candidate with source metadata and honors declaration order", async () => {
    const existing = new Set(["/path-b/custom", "/path-a/tool", "/known/tool"]);
    const executor: CliProcessExecutor = { execute: vi.fn(async () => success()) };
    const resolver = new CommandResolver({
      platform: "linux",
      env: { PATH: "/path-a:/path-b" },
      homeDir: "/home/test",
      fileSystem: {
        exists: async (filePath) => existing.has(filePath),
        executable: async (filePath) => existing.has(filePath),
      },
      executor,
    });

    const result = await resolver.resolve({
      commandOverride: "custom",
      defaultCommand: "tool",
      aliases: ["tool-alias"],
      supplementalPaths: [],
      knownPaths: ["/known/tool"],
    });

    expect(result.originalCommand).toBe("custom");
    expect(result.selected?.path).toBe("/path-b/custom");
    expect(result.state).toBe("runnable");
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/path-b/custom", declarationSource: "command-override", locationSource: "path" }),
      expect.objectContaining({ path: "/path-a/tool", declarationSource: "manifest-default", locationSource: "path" }),
      expect.objectContaining({ path: "/known/tool", locationSource: "known-path" }),
      expect.objectContaining({ path: "/path-a/tool-alias", state: "not-found" }),
    ]));
  });

  it("distinguishes found, runnable, and connected probes", async () => {
    const execute = vi.fn(async (spec: { args: string[] }) =>
      spec.args[0] === "hello" ? success("hello") : success("tool 2.0.0"));
    const resolver = new CommandResolver({
      platform: "darwin",
      env: { PATH: "/bin" },
      fileSystem: { exists: async () => true, executable: async () => true },
      executor: { execute },
    });

    const result = await resolver.resolve({
      defaultCommand: "tool",
      supplementalPaths: [],
      helloProbe: (candidate) => ({ command: candidate.path, args: ["hello"] }),
    });
    expect(result.state).toBe("connected");
    expect(result.selected?.version).toBe("tool 2.0.0");
    expect(execute).toHaveBeenCalledTimes(2);

    const notRunnable = new CommandResolver({
      platform: "linux",
      env: { PATH: "/bin" },
      fileSystem: { exists: async () => true, executable: async () => false },
      executor: { execute: vi.fn() },
    });
    expect((await notRunnable.resolve({ defaultCommand: "tool", supplementalPaths: [] })).state).toBe("found");
  });

  it("keeps auto-resolved cache separate from a changed user command override", async () => {
    const resolver = new CommandResolver({
      platform: "linux",
      env: { PATH: "/bin" },
      fileSystem: { exists: async () => true, executable: async () => true },
      executor: { execute: async () => success() },
    });
    const first = await resolver.resolve({ defaultCommand: "tool", supplementalPaths: [], cacheKey: "plugin" });
    const second = await resolver.resolve({
      commandOverride: "custom",
      defaultCommand: "tool",
      supplementalPaths: [],
      cacheKey: "plugin",
    });
    expect(first.cachedPath).toBe("/bin/tool");
    expect(second.originalCommand).toBe("custom");
    expect(second.selected?.path).toBe("/bin/custom");
    expect(second.candidates.find((candidate) => candidate.locationSource === "cache")).toBeUndefined();
  });

  it("uses Windows PATHEXT order and expands known Windows paths", async () => {
    const expected = "C:\\Users\\tester\\AppData\\Roaming\\npm\\tool.CMD";
    const resolver = new CommandResolver({
      platform: "win32",
      env: {
        Path: "C:\\bin",
        PATHEXT: ".EXE;.CMD",
        APPDATA: "C:\\Users\\tester\\AppData\\Roaming",
      },
      homeDir: "C:\\Users\\tester",
      fileSystem: {
        exists: async (filePath) => filePath === expected,
        executable: async (filePath) => filePath === expected,
      },
      executor: { execute: async () => success("tool 3") },
    });
    const result = await resolver.resolve({
      defaultCommand: "tool",
      supplementalPaths: [],
      knownPaths: ["%APPDATA%\\npm\\tool.CMD"],
    });
    expect(result.selected?.path).toBe(expected);
    expect(result.candidates.slice(0, 2).map((candidate) => candidate.path)).toEqual([
      "C:\\bin\\tool.EXE",
      "C:\\bin\\tool.CMD",
    ]);
  });

  it("provides bounded supplemental paths without reading shell startup files", () => {
    expect(defaultSupplementalPaths("darwin", {}, "/Users/test")).toContain("/opt/homebrew/bin");
    expect(defaultSupplementalPaths("linux", {}, "/home/test")).toContain("/home/test/.local/bin");
    expect(defaultSupplementalPaths("win32", { APPDATA: "C:\\Users\\test\\AppData\\Roaming" }, "C:\\Users\\test"))
      .toContain("C:\\Users\\test\\AppData\\Roaming\\npm");
  });
});

describe("controlled process execution", () => {
  it("rejects shell command strings at the host boundary", async () => {
    const executor = new ControlledProcessExecutor();
    await expect(executor.execute({ command: "tool && other", args: [] })).rejects.toMatchObject({
      code: "SPAWN_FAILED",
      message: "Shell command strings are not allowed",
    });
  });

  it("unwraps a Windows npm .cmd shim to its JavaScript entry", async () => {
    const shimPath = "C:\\npm\\tool.cmd";
    const entry = "C:\\npm\\node_modules\\tool\\cli.js";
    const contents = '@IF EXIST "%~dp0%\\node.exe" "%~dp0%\\node.exe" "%~dp0%\\node_modules\\tool\\cli.js" %*';
    expect(parseWindowsNpmShim(shimPath, contents)).toContain(entry);

    const target = await prepareSpawnTarget(shimPath, ["run"], "win32", {}, {
      readFile: async () => contents,
      exists: async (candidate) => candidate === entry,
      nodeExecutable: "C:\\node\\node.exe",
    });
    expect(target).toEqual({ command: "C:\\node\\node.exe", args: [entry, "run"] });
  });

  it("times out and cancels without enabling shell execution", async () => {
    const executor = new ControlledProcessExecutor({ platform: process.platform as "darwin" | "linux" | "win32" });
    const longRunning = { command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] };

    await expect(executor.execute(longRunning, { timeoutMs: 30 })).rejects.toMatchObject({
      code: "PROCESS_TIMEOUT",
    } satisfies Partial<CliPluginError>);

    const controller = new AbortController();
    const cancelled = executor.execute(longRunning, { signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await expect(cancelled).rejects.toMatchObject({ code: "PROCESS_CANCELLED" });
  });

  it("redacts sensitive environment values from diagnostics", () => {
    const diagnostic = redactProcessDiagnostic({
      command: "tool",
      args: ["--token", "do-not-log-args"],
      envPatch: { API_TOKEN: "secret", PATH: "/bin" },
    });
    expect(diagnostic).toEqual({
      command: "tool",
      argumentCount: 2,
      cwd: undefined,
      envPatch: { API_TOKEN: "***REDACTED***", PATH: "/bin" },
    });
    expect(JSON.stringify(diagnostic)).not.toContain("secret");
    expect(JSON.stringify(diagnostic)).not.toContain("do-not-log-args");
  });
});

describe("platform compatibility exports", () => {
  it("keeps legacy pure utility exports available", async () => {
    const platform = await import("@/lib/platform");
    expect(platform.toForwardSlash("C:\\work\\tool")).toBe("C:/work/tool");
    expect(platform.normalizePath("C:/work/../tool", "win32")).toBe("C:\\tool");
    expect(platform.quoteForCmd("hello world")).toBe('"hello world"');
    expect(path.win32.isAbsolute(platform.normalizePath("C:/tool", "win32"))).toBe(true);
  });
});
