import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { isCliPluginManifestV1, type CliHostContext } from "@tower/ai-sdk";
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
    const resumed = adapter.buildSessionProcess({
      prompt: "ignored", cwd: "/work", mode: { type: "resume", sessionId: "s-1" }, systemPrompt,
    });
    expect(resumed.args).toEqual([
      "--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust",
      "-c", `developer_instructions=${JSON.stringify(systemPrompt)}`,
      "resume", "s-1",
    ]);
    expect(resumed.args).not.toContain("--append-system-prompt");
    expect(adapter.buildHelloProbe({ command: "/bin/codex", cwd: "/work", prompt: "hello" }))
      .toEqual({ command: "/bin/codex", args: ["exec", "hello"], cwd: "/work" });
  });

  it("uses resume --last and preserves a long quoted prompt without shell syntax", () => {
    const adapter = new CodexCliAdapter(host());
    expect(adapter.buildSessionProcess({ prompt: "", cwd: "/work", mode: { type: "continue" } }).args)
      .toEqual([
        "--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust",
        "resume", "--last",
      ]);
    expect(adapter.classifySessionFailure({
      mode: { type: "continue" }, exitCode: 1, output: "no rollout found for session",
    })).toMatchObject({ code: "SESSION_NOT_FOUND", retryableWithFresh: true });
    const prompt = `${"x".repeat(20_000)}\n'\";$()`;
    const plan = adapter.buildSessionProcess({ prompt, cwd: "/work", mode: { type: "fresh" } });
    expect(plan.command).toBe("/bin/codex");
    expect(plan.args.at(-1)).toBe(prompt);
  });

  it("reports safe rate-limit query failures without exposing stderr", async () => {
    const ctx = host();
    vi.mocked(ctx.process.stream!).mockImplementationOnce(processStream("", "429 quota exceeded SECRET", 1));
    await expect(new CodexCliAdapter(ctx).generate({ prompt: "secret prompt" })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "Codex query failed",
    });
  });

  it("streams Codex JSONL items with paired MCP tools and safe headless arguments", async () => {
    const ctx = host();
    const fixture = fs.readFileSync(new URL("./fixtures/stream.jsonl", import.meta.url), "utf8");
    vi.mocked(ctx.process.execute).mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      stdout: JSON.stringify([
        { name: "tower-dev", enabled: true },
        { name: "unrelated", enabled: true, transport: { env: { SECRET: "CANARY_SECRET" } } },
      ]),
      stderr: "",
      durationMs: 1,
    });
    vi.mocked(ctx.process.stream!).mockImplementationOnce(processStream(fixture));
    const events = [];
    for await (const event of new CodexCliAdapter(ctx).stream({
      prompt: "PROMPT_CANARY",
      tools: ["mcp__tower-dev__list_tasks", "mcp__other_server__blocked"],
      allowedTools: ["mcp__tower-dev__list_tasks"],
    })) events.push(event);

    expect(events).toContainEqual({ type: "session", sessionId: "codex-thread" });
    expect(events).toContainEqual({ type: "reasoning", text: "checking" });
    expect(events).toContainEqual({ type: "text", text: "Hello" });
    expect(events.filter((event) => event.type === "text")).toEqual([{ type: "text", text: "Hello" }]);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool-call", toolCall: expect.objectContaining({ id: "tool-1" }) }));
    expect(events).toContainEqual(expect.objectContaining({ type: "tool-result", toolResult: expect.objectContaining({ id: "tool-1" }) }));
    expect(ctx.process.stream).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([
        "--json", "--sandbox", "read-only", "--disable", "shell_tool",
        "-c", "mcp_servers.unrelated.enabled=false",
        "-c", "mcp_servers.tower-dev.enabled=true",
        "-c", 'mcp_servers.tower-dev.enabled_tools=["list_tasks"]',
      ]),
    }), expect.any(Object));
    expect(JSON.stringify(vi.mocked(ctx.process.stream!).mock.calls[0]?.[0].args)).not.toContain("blocked");
    expect(JSON.stringify(vi.mocked(ctx.process.stream!).mock.calls[0]?.[0].args)).not.toContain("CANARY_SECRET");
  });

  it("fails before query output when the requested MCP server is unavailable", async () => {
    const ctx = host();
    vi.mocked(ctx.process.execute).mockResolvedValueOnce({
      exitCode: 0, signal: null, stdout: "[]", stderr: "", durationMs: 1,
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
});
