import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CliPluginError, isCliPluginManifestV1, type CliHostContext } from "@tower-org/ai-sdk";
import { CodexCliAdapter, codexManifest } from "../src/index.js";

function processStream(stdout = "", stderr = "", exitCode = 0) {
  return async function* () {
    const bytes = Buffer.from(stdout);
    for (let index = 0; index < bytes.length; index += 5) {
      yield { type: "stdout" as const, chunk: bytes.subarray(index, index + 5) };
    }
    if (stderr) yield { type: "stderr" as const, chunk: Buffer.from(stderr) };
    yield { type: "exit" as const, exitCode, signal: null, durationMs: 1 };
  };
}

function host(): CliHostContext {
  return {
    platform: "linux", arch: "x64", storageDir: "/tmp/provider", signal: new AbortController().signal,
    process: {
      execute: vi.fn(async () => ({ exitCode: 0, signal: null, stdout: "[]", stderr: "", durationMs: 1 })),
      stream: vi.fn(processStream()),
      probeMcpServer: vi.fn(async () => false),
    },
    fileSystem: {
      exists: () => false, mkdir() {}, readText: () => "", writeText() {}, lstat: async () => null,
      readLink: async () => "", symlink: async () => {}, unlink: async () => {},
    },
    resources: {
      homeDir: "/tmp",
      providerConfigDir: "/tmp/.codex",
      commandPath: "/bin/codex",
      towerPackageRoot: "/opt/tower",
      managedConfigPaths: [],
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };
}

describe("Codex provider", () => {
  it("publishes its package manifest and strict 2020-12 schema", () => {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const schema = JSON.parse(fs.readFileSync(new URL("../config.schema.json", import.meta.url), "utf8"));
    expect(pkg.tower).toEqual(codexManifest);
    expect(isCliPluginManifestV1(pkg.tower)).toBe(true);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(codexManifest.capabilities.integrations).toEqual({ mcp: true, hooks: true, skills: true });
  });

  it("uses argv-only TOML developer instructions for fresh and resume", () => {
    const adapter = new CodexCliAdapter(host());
    const systemPrompt = "line \"quoted\"\nnext";
    const fresh = adapter.buildSessionProcess({
      prompt: "fix it",
      cwd: "/work",
      mode: { type: "fresh" },
      systemPrompt,
      model: "gpt-5.5",
    });
    expect(fresh.args).toEqual([
      "--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust",
      "-c", `developer_instructions=${JSON.stringify(systemPrompt)}`,
      "--model", "gpt-5.5", "fix it",
    ]);
    expect(fresh.startsAtInputBoundary).toBe(false);
    const resumed = adapter.buildSessionProcess({
      prompt: "ignored", cwd: "/work", mode: { type: "resume", sessionId: "s-1" }, systemPrompt,
    });
    expect(resumed.args).toEqual([
      "--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust",
      "-c", `developer_instructions=${JSON.stringify(systemPrompt)}`,
      "resume", "s-1",
    ]);
    expect(resumed.args).not.toContain("--append-system-prompt");
    expect(resumed.startsAtInputBoundary).toBe(true);
    expect(adapter.buildHelloProbe({ command: "/bin/codex", cwd: "/work", prompt: "hello" }))
      .toEqual({ command: "/bin/codex", args: ["exec", "hello"], cwd: "/work" });
  });

  it("uses resume --last and preserves a long quoted prompt without shell syntax", () => {
    const adapter = new CodexCliAdapter(host());
    const continued = adapter.buildSessionProcess({ prompt: "", cwd: "/work", mode: { type: "continue" } });
    expect(continued.args).toEqual([
        "--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust",
        "resume", "--last",
      ]);
    expect(continued.startsAtInputBoundary).toBe(true);
    expect(adapter.buildSessionProcess({ prompt: "", cwd: "/work", mode: { type: "fresh" } }).startsAtInputBoundary)
      .toBe(true);
    expect(adapter.classifySessionFailure({
      mode: { type: "continue" }, exitCode: 1, output: "no rollout found for session",
    })).toMatchObject({ code: "SESSION_NOT_FOUND", retryableWithFresh: true });
    const prompt = `${"x".repeat(20_000)}\n'\";$()`;
    const plan = adapter.buildSessionProcess({ prompt, cwd: "/work", mode: { type: "fresh" } });
    expect(plan.command).toBe("/bin/codex");
    expect(plan.args.at(-1)).toBe(prompt);
    expect(plan.startsAtInputBoundary).toBe(false);
  });

  it("reports safe rate-limit query failures without exposing stderr", async () => {
    const ctx = host();
    vi.mocked(ctx.process.stream!).mockImplementationOnce(processStream("", "429 quota exceeded SECRET", 1));
    await expect(new CodexCliAdapter(ctx).generate({ prompt: "secret prompt" })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "Codex query failed",
    });
  });

  it("forwards the query timeout and exposes only the safe Host timeout", async () => {
    const ctx = host();
    vi.mocked(ctx.process.stream!).mockImplementationOnce(async function* (_spec, options) {
      expect(options?.timeoutMs).toBe(1_234);
      throw new CliPluginError("PROCESS_TIMEOUT", "Process timed out after 1234ms");
    });
    const error = await new CodexCliAdapter(ctx).generate({
      prompt: "PROMPT_CANARY",
      timeoutMs: 1_234,
    }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: "PROCESS_TIMEOUT", message: "Process timed out after 1234ms" });
    expect(JSON.stringify(error)).not.toMatch(/PROMPT_CANARY|STDERR_CANARY/);
  });

  it("streams Codex JSONL items with paired MCP tools and safe headless arguments", async () => {
    const ctx = host();
    const fixture = fs.readFileSync(new URL("./fixtures/stream.jsonl", import.meta.url), "utf8");
    vi.mocked(ctx.process.execute).mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      stdout: JSON.stringify({
        name: "tower-dev",
        enabled: true,
        transport: {
          type: "stdio",
          command: "node",
          args: ["server.js"],
          env: { TOWER_TOKEN: "CANARY_SECRET" },
          env_vars: ["TOWER_TASK_ID"],
        },
      }),
      stderr: "",
      durationMs: 1,
    });
    vi.mocked(ctx.process.stream!).mockImplementationOnce(processStream(fixture));
    const events = [];
    for await (const event of new CodexCliAdapter(ctx).stream({
      prompt: "PROMPT_CANARY",
      timeoutMs: 12_345,
      effort: "medium",
      attachments: [{ filename: "image.png", path: "/safe/image.png", mediaType: "image/png" }],
      tools: ["mcp__tower-dev__list_tasks", "mcp__other_server__blocked"],
      allowedTools: ["mcp__tower-dev__list_tasks"],
    })) events.push(event);

    expect(events).toContainEqual({ type: "session", sessionId: "codex-thread" });
    expect(events).toContainEqual({ type: "reasoning", text: "checking" });
    expect(events).toContainEqual({ type: "text", text: "Hello" });
    expect(events.filter((event) => event.type === "text")).toEqual([{ type: "text", text: "Hello" }]);
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool-call", toolCall: expect.objectContaining({ id: "tool-1", name: "mcp__tower-dev__list_tasks" }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool-result", toolResult: expect.objectContaining({ id: "tool-1", name: "mcp__tower-dev__list_tasks" }),
    }));
    expect(ctx.process.stream).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([
        "--ignore-user-config", "--json", "--sandbox", "read-only", "--disable", "shell_tool",
        "-c", 'model_reasoning_effort="medium"', "--image", "/safe/image.png",
        "-c", 'mcp_servers.tower-dev.command="node"',
        "-c", 'mcp_servers.tower-dev.args=["server.js"]',
        "-c", 'mcp_servers.tower-dev.env_vars=["TOWER_TASK_ID","TOWER_TOKEN"]',
        "-c", "mcp_servers.tower-dev.enabled=true",
        "-c", 'mcp_servers.tower-dev.enabled_tools=["list_tasks"]',
      ]),
      envPatch: { TOWER_TOKEN: "CANARY_SECRET" },
    }), expect.objectContaining({ timeoutMs: 12_345 }));
    expect(ctx.process.execute).toHaveBeenCalledWith(expect.objectContaining({
      args: ["mcp", "get", "tower-dev", "--json"],
    }), expect.objectContaining({ timeoutMs: 5_000 }));
    expect(JSON.stringify(vi.mocked(ctx.process.stream!).mock.calls[0]?.[0].args)).not.toContain("blocked");
    expect(JSON.stringify(vi.mocked(ctx.process.stream!).mock.calls[0]?.[0].args)).not.toContain("CANARY_SECRET");
  });

  it.each([
    ["mcp-probe-connected.jsonl", { installed: true, status: "connected" }],
    ["mcp-probe-disconnected.jsonl", { installed: true, status: "disconnected" }],
  ])("probes the configured Codex stdio MCP transport with %s", async (fixture, expected) => {
    const ctx = host();
    vi.mocked(ctx.process.execute).mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      stdout: fs.readFileSync(new URL("./fixtures/mcp-enabled.json", import.meta.url), "utf8"),
      stderr: "",
      durationMs: 1,
    });
    vi.mocked(ctx.process.probeMcpServer!).mockResolvedValueOnce(fixture === "mcp-probe-connected.jsonl");
    await expect(new CodexCliAdapter(ctx).mcp.inspect({ name: "tower-dev" })).resolves.toEqual(expected);
    expect(ctx.process.execute).toHaveBeenCalledWith(expect.objectContaining({
      args: ["mcp", "get", "tower-dev", "--json"],
    }), expect.objectContaining({ timeoutMs: 5_000 }));
    expect(ctx.process.probeMcpServer).toHaveBeenCalledWith(expect.objectContaining({
      name: "tower-dev",
      timeoutMs: 5_000,
    }));
    expect(ctx.process.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ args: ["mcp", "list", "--json"] }),
      expect.anything(),
    );
  });

  it("reports a disabled Codex MCP entry as pending without starting it", async () => {
    const ctx = host();
    vi.mocked(ctx.process.execute).mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      stdout: fs.readFileSync(new URL("./fixtures/mcp-pending.json", import.meta.url), "utf8"),
      stderr: "",
      durationMs: 1,
    });
    await expect(new CodexCliAdapter(ctx).mcp.inspect({ name: "tower-dev" })).resolves.toEqual({
      installed: true,
      status: "pending",
    });
    expect(ctx.process.probeMcpServer).not.toHaveBeenCalled();
  });

  it("fails before query output when the requested MCP server is unavailable", async () => {
    const ctx = host();
    vi.mocked(ctx.process.execute).mockResolvedValueOnce({
      exitCode: 1, signal: null, stdout: "", stderr: "MCP server not found", durationMs: 1,
    });
    await expect(new CodexCliAdapter(ctx).generate({
      prompt: "PROMPT_CANARY",
      tools: ["mcp__tower-dev__list_tasks"],
      allowedTools: ["mcp__tower-dev__list_tasks"],
    })).rejects.toMatchObject({ code: "TOOLING_UNAVAILABLE" });
    expect(ctx.process.stream).not.toHaveBeenCalled();
  });

  it("runs Hooks, MCP, and Skills through injected Host services", async () => {
    const ctx = host();
    const writes: Array<{ path: string; contents: string }> = [];
    const symlink = vi.fn(async () => {});
    ctx.fileSystem!.exists = () => true;
    ctx.fileSystem!.readText = (path) => path.endsWith("config.toml")
      ? '[mcp_servers.tower]\ncommand = "node"\n'
      : "";
    ctx.fileSystem!.writeText = (path, contents) => writes.push({ path, contents });
    ctx.fileSystem!.symlink = symlink;
    const adapter = new CodexCliAdapter(ctx);

    await expect(adapter.hooks.install({ apiUrl: "http://localhost:3000" }))
      .resolves.toMatchObject({ installed: true });
    expect(writes.find((item) => item.path.endsWith("hooks.json"))?.contents)
      .toContain("request_user_input");
    expect(writes.findLast((item) => item.path.endsWith("config.toml"))?.contents)
      .toContain('notify = ["node","/opt/tower/scripts/tower-codex-notify.js"]');
    await expect(adapter.mcp.install({
      name: "tower",
      command: "node",
      args: ["server.js"],
      env: { DATABASE_URL: "file:test.db" },
      envVars: ["TOWER_TASK_ID"],
      scope: "user",
    })).resolves.toMatchObject({ installed: true });
    await expect(adapter.skills.install({ name: "tower", sourceDir: "/opt/tower/skills/tower" }))
      .resolves.toMatchObject({ installed: true });
    expect(symlink).toHaveBeenCalledWith(
      "/opt/tower/skills/tower",
      "/tmp/.codex/skills/tower",
      "dir",
    );
    expect(ctx.process.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "/bin/codex",
        args: expect.arrayContaining(["mcp", "add", "tower", "--env", "DATABASE_URL=file:test.db"]),
      }),
      expect.any(Object),
    );
  });

  it("keeps the turn-complete notifier beside user hooks and chains an existing notifier", async () => {
    const ctx = host();
    const files = new Map<string, string>([
      ["/tmp/.codex/config.toml", 'notify = ["notify-send","Codex"]\n\n[features]\nhooks = true\n'],
      ["/tmp/.codex/hooks.json", JSON.stringify({ hooks: {} })],
    ]);
    ctx.fileSystem!.exists = (filePath) => files.has(filePath) || filePath === "/tmp/.codex";
    ctx.fileSystem!.readText = (filePath) => files.get(filePath) ?? "";
    ctx.fileSystem!.writeText = (filePath, contents) => { files.set(filePath, contents); };
    const adapter = new CodexCliAdapter(ctx);

    await expect(adapter.hooks.install({ apiUrl: "http://localhost:3000" }))
      .resolves.toMatchObject({ installed: true });

    const config = files.get("/tmp/.codex/config.toml") ?? "";
    expect(config).toContain('notify = ["node","/opt/tower/scripts/tower-codex-notify.js","--chain-base64"');
    expect(config).not.toContain('notify = ["notify-send","Codex"]');
    await expect(adapter.hooks.inspect()).resolves.toEqual({ installed: true });
  });
});
