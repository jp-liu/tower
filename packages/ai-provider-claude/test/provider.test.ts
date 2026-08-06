import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CliPluginError, isCliPluginManifestV1, type CliHostContext } from "@tower-org/ai-sdk";
import { ClaudeCliAdapter, claudeManifest, towerCliPlugin } from "../src/index.js";

function processStream(stdout = "", stderr = "", exitCode = 0) {
  return async function* () {
    const bytes = Buffer.from(stdout);
    for (let index = 0; index < bytes.length; index += 7) {
      yield { type: "stdout" as const, chunk: bytes.subarray(index, index + 7) };
    }
    if (stderr) yield { type: "stderr" as const, chunk: Buffer.from(stderr) };
    yield { type: "exit" as const, exitCode, signal: null, durationMs: 1 };
  };
}

function host(): CliHostContext {
  return {
    platform: "linux",
    arch: "x64",
    storageDir: "/tmp/tower-provider-test",
    signal: new AbortController().signal,
    process: {
      execute: vi.fn(async () => ({ exitCode: 0, signal: null, stdout: "ok", stderr: "", durationMs: 1 })),
      stream: vi.fn(processStream()),
    },
    fileSystem: {
      exists: () => false, mkdir() {}, readText: () => "", writeText() {},
      lstat: async () => null, readLink: async () => "", symlink: async () => {}, unlink: async () => {},
    },
    resources: {
      homeDir: "/tmp",
      providerConfigDir: "/tmp/.claude",
      commandPath: "/bin/claude",
      towerPackageRoot: "/opt/tower",
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };
}

describe("Claude provider", () => {
  it("publishes matching manifest and JSON Schema 2020-12 metadata", () => {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const schema = JSON.parse(fs.readFileSync(new URL("../config.schema.json", import.meta.url), "utf8"));
    expect(pkg.tower).toEqual(claudeManifest);
    expect(isCliPluginManifestV1(pkg.tower)).toBe(true);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.additionalProperties).toBe(false);
    expect(towerCliPlugin.manifest.capabilities.integrations).toEqual({ mcp: true, hooks: true, skills: true });
  });

  it("builds fresh, resume, and continue plans in Claude CLI order", () => {
    const adapter = new ClaudeCliAdapter(host());
    const fresh = adapter.buildSessionProcess({
      prompt: "fix 'quoted'\ntext",
      cwd: "/work",
      mode: { type: "fresh" },
      systemPrompt: "Tower rules",
      model: "sonnet",
    });
    expect(fresh.args).toEqual([
      "--dangerously-skip-permissions",
      "--append-system-prompt", "Tower rules",
      "--model", "sonnet",
      "fix 'quoted'\ntext",
    ]);
    expect(fresh.startsAtInputBoundary).toBe(false);
    const resumed = adapter.buildSessionProcess({ prompt: "ignored", cwd: "/work", mode: { type: "resume", sessionId: "s-1" } });
    expect(resumed.args).toEqual(["--dangerously-skip-permissions", "--resume", "s-1"]);
    expect(resumed.startsAtInputBoundary).toBe(true);
    const continued = adapter.buildSessionProcess({ prompt: "ignored", cwd: "/work", mode: { type: "continue" } });
    expect(continued.args).toEqual(["--dangerously-skip-permissions", "--continue"]);
    expect(continued.startsAtInputBoundary).toBe(true);
    expect(adapter.buildSessionProcess({ prompt: "", cwd: "/work", mode: { type: "fresh" } }).startsAtInputBoundary)
      .toBe(true);
    expect(adapter.buildHelloProbe({ command: "/bin/claude", cwd: "/work", prompt: "hello" })).toEqual({
      command: "/bin/claude",
      args: ["--print", "hello", "--output-format", "stream-json", "--verbose"],
      cwd: "/work",
    });
  });

  it("keeps long prompts structured and classifies only known session failures as fresh-retryable", () => {
    const adapter = new ClaudeCliAdapter(host());
    const prompt = "x".repeat(20_000);
    const spec = adapter.buildSessionProcess({ prompt, cwd: "/work", mode: { type: "fresh" } });
    expect(spec.command).toBe("/bin/claude");
    expect(spec.args.at(-1)).toBe(prompt);
    expect(adapter.classifySessionFailure({ mode: { type: "resume", sessionId: "x" }, exitCode: 1, output: "No conversation found with session id" }))
      .toMatchObject({ code: "SESSION_NOT_FOUND", retryableWithFresh: true });
    expect(adapter.classifySessionFailure({ mode: { type: "continue" }, exitCode: 1, output: "network failed" }).retryableWithFresh)
      .toBe(false);
  });

  it("reports safe authentication and no-output query codes", async () => {
    const ctx = host();
    vi.mocked(ctx.process.stream!)
      .mockImplementationOnce(processStream("", "401 unauthorized SECRET", 1))
      .mockImplementationOnce(processStream());
    const adapter = new ClaudeCliAdapter(ctx);
    await expect(adapter.generate({ prompt: "secret prompt" })).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED",
      message: "Claude query failed",
    });
    await expect(adapter.generate({ prompt: "secret prompt" })).rejects.toMatchObject({ code: "NO_OUTPUT" });
  });

  it("forwards the query timeout and exposes only the safe Host timeout", async () => {
    const ctx = host();
    vi.mocked(ctx.process.stream!).mockImplementationOnce(async function* (_spec, options) {
      expect(options?.timeoutMs).toBe(1_234);
      throw new CliPluginError("PROCESS_TIMEOUT", "Process timed out after 1234ms");
    });
    const error = await new ClaudeCliAdapter(ctx).generate({
      prompt: "PROMPT_CANARY",
      timeoutMs: 1_234,
    }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: "PROCESS_TIMEOUT", message: "Process timed out after 1234ms" });
    expect(JSON.stringify(error)).not.toMatch(/PROMPT_CANARY|STDERR_CANARY/);
  });

  it("streams Claude JSONL events and forwards the restricted tool contract", async () => {
    const ctx = host();
    const fixture = fs.readFileSync(new URL("./fixtures/stream.jsonl", import.meta.url), "utf8");
    vi.mocked(ctx.process.stream!).mockImplementationOnce(processStream(fixture));
    const events = [];
    for await (const event of new ClaudeCliAdapter(ctx).stream({
      prompt: "PROMPT_CANARY",
      maxTurns: 4,
      effort: "low",
      attachments: [{ filename: "image.png", path: "/safe/image.png", mediaType: "image/png", dataBase64: "IMAGE_CANARY" }],
      timeoutMs: 12_345,
      tools: ["mcp__tower-dev__list_tasks", "mcp__other__blocked"],
      allowedTools: ["mcp__tower-dev__list_tasks"],
      mcpServers: [{
        name: "tower-dev",
        command: "node",
        args: ["/opt/tower/mcp-server.cjs"],
        env: { TOWER_MCP_PROFILE: "assistant" },
      }],
    })) events.push(event);

    expect(events).toContainEqual({ type: "session", sessionId: "claude-session" });
    expect(events).toContainEqual({ type: "text", text: "你好 " });
    expect(events).toContainEqual({ type: "reasoning", text: "check " });
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool-call", toolCall: expect.objectContaining({ id: "tool-1", name: "mcp__tower-dev__list_tasks" }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool-result", toolResult: expect.objectContaining({ id: "tool-1", name: "mcp__tower-dev__list_tasks" }),
    }));
    expect(ctx.process.stream).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([
        "--output-format", "stream-json", "--tools", "mcp__tower-dev__list_tasks",
        "--max-turns", "4", "--effort", "low", "--input-format", "stream-json",
        "--allowedTools", "mcp__tower-dev__list_tasks",
        "--strict-mcp-config",
      ]),
    }), expect.objectContaining({ timeoutMs: 12_345 }));
    const args = vi.mocked(ctx.process.stream!).mock.calls[0]?.[0].args ?? [];
    const mcpConfig = args[args.indexOf("--mcp-config") + 1];
    expect(JSON.parse(mcpConfig!)).toEqual({
      mcpServers: {
        "tower-dev": {
          command: "node",
          args: ["/opt/tower/mcp-server.cjs"],
          env: { TOWER_MCP_PROFILE: "assistant" },
        },
      },
    });
    expect(vi.mocked(ctx.process.stream!).mock.calls[0]?.[0].initialInput).toContain("IMAGE_CANARY");
    expect(vi.mocked(ctx.process.stream!).mock.calls[0]?.[0].initialInput).not.toContain("/safe/image.png");
    expect(JSON.stringify(vi.mocked(ctx.process.stream!).mock.calls[0]?.[0].args)).not.toContain("blocked");
  });

  it.each([
    ["mcp-connected.txt", { installed: true, status: "connected" }],
    ["mcp-connected-modern.txt", { installed: true, status: "connected" }],
    ["mcp-pending.txt", { installed: true, status: "pending" }],
    ["mcp-disconnected.txt", { installed: true, status: "disconnected" }],
  ])("derives MCP runtime health from Claude's first-party %s output", async (fixture, expected) => {
    const ctx = host();
    vi.mocked(ctx.process.execute).mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      stdout: fs.readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8"),
      stderr: "",
      durationMs: 1,
    });
    await expect(new ClaudeCliAdapter(ctx).mcp.inspect({ name: "tower-dev" })).resolves.toEqual(expected);
  });

  it("runs Hooks, MCP, and Skills through injected Host services", async () => {
    const ctx = host();
    const writes: Array<{ path: string; contents: string }> = [];
    const symlink = vi.fn(async () => {});
    ctx.fileSystem!.exists = () => true;
    ctx.fileSystem!.writeText = (path, contents) => writes.push({ path, contents });
    ctx.fileSystem!.symlink = symlink;
    const adapter = new ClaudeCliAdapter(ctx);

    await expect(adapter.hooks.install({ apiUrl: "http://localhost:3000" }))
      .resolves.toMatchObject({ installed: true });
    const settings = writes.find((item) => item.path.endsWith("settings.json"));
    expect(settings?.contents).toContain("SessionStart");
    expect(settings?.contents).toContain("PreToolUse");
    await expect(adapter.mcp.install({
      name: "tower",
      command: "node",
      args: ["server.js"],
      scope: "user",
    })).resolves.toMatchObject({ installed: true });
    await expect(adapter.skills.install({ name: "tower", sourceDir: "/opt/tower/skills/tower" }))
      .resolves.toMatchObject({ installed: true });
    expect(symlink).toHaveBeenCalledWith(
      "/opt/tower/skills/tower",
      "/tmp/.claude/skills/tower",
      "dir",
    );
    expect(ctx.process.execute).toHaveBeenCalledWith(
      expect.objectContaining({ command: "/bin/claude", args: expect.arrayContaining(["mcp", "add-json"]) }),
      expect.any(Object),
    );
  });
});
