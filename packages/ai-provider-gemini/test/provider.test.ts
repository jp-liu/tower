import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CliPluginError, isCliPluginManifestV1, type CliAdapter, type CliHostContext } from "@tower-org/ai-sdk";
import { GeminiCliAdapter, geminiManifest } from "../src/index.js";

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
      execute: vi.fn(async () => ({ exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1 })),
      stream: vi.fn(processStream()),
    },
    fileSystem: {
      exists: () => false, mkdir() {}, readText: () => "", writeText() {}, lstat: async () => null,
      readLink: async () => "", symlink: async () => {}, unlink: async () => {},
    },
    resources: { homeDir: "/tmp", providerConfigDir: "/tmp/.gemini", commandPath: "/bin/gemini" },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };
}

describe("Gemini provider", () => {
  it("accurately declares stable MCP/Skills support and unsupported Hooks", () => {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const schema = JSON.parse(fs.readFileSync(new URL("../config.schema.json", import.meta.url), "utf8"));
    expect(pkg.tower).toEqual(geminiManifest);
    expect(isCliPluginManifestV1(pkg.tower)).toBe(true);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(geminiManifest.capabilities.integrations).toEqual({ mcp: true, hooks: false, skills: true });
    const adapter: CliAdapter = new GeminiCliAdapter(host());
    expect(adapter.hooks).toBeUndefined();
  });

  it("sends fresh system instructions and user prompt as one initial input", () => {
    const adapter = new GeminiCliAdapter(host());
    const prompt = `long ${"x".repeat(20_000)}\n'\";$()`;
    const plan = adapter.buildSessionProcess({
      prompt,
      cwd: "/work",
      mode: { type: "fresh" },
      systemPrompt: "Tower rules\nsecond line",
      model: "gemini-2.5-pro",
    });
    expect(plan.args).toEqual(["--yolo", "--model", "gemini-2.5-pro"]);
    expect(plan.args).not.toContain("--append-system-prompt");
    expect(plan.initialInput).toContain("Tower system instructions (23 characters):\nTower rules\nsecond line");
    expect(plan.initialInput).toContain(`User prompt (${prompt.length} characters):\n${prompt}`);
    expect(plan.startsAtInputBoundary).toBe(false);
  });

  it("maps resume and continue to Gemini 0.38 semantics without initial input", () => {
    const adapter = new GeminiCliAdapter(host());
    const resume = adapter.buildSessionProcess({ prompt: "ignored", cwd: "/work", mode: { type: "resume", sessionId: "7" } });
    const latest = adapter.buildSessionProcess({ prompt: "ignored", cwd: "/work", mode: { type: "continue" } });
    expect(resume.args).toEqual(["--yolo", "--resume", "7"]);
    expect(latest.args).toEqual(["--yolo", "--resume", "latest"]);
    expect(resume.initialInput).toBeUndefined();
    expect(latest.initialInput).toBeUndefined();
    expect(resume.startsAtInputBoundary).toBe(true);
    expect(latest.startsAtInputBoundary).toBe(true);
    expect(adapter.buildHelloProbe({ command: "/bin/gemini", cwd: "/work", prompt: "hello" })).toEqual({
      command: "/bin/gemini",
      args: ["--prompt", "hello", "--output-format", "json"],
      cwd: "/work",
    });
    expect(adapter.classifySessionFailure({
      mode: { type: "resume", sessionId: "7" }, exitCode: 1, output: "session 7 not found",
    })).toMatchObject({ code: "SESSION_NOT_FOUND", retryableWithFresh: true });
  });

  it("does not submit an empty initial input for a clean fresh terminal", () => {
    const adapter = new GeminiCliAdapter(host());
    const plan = adapter.buildSessionProcess({ prompt: "", cwd: "/work", mode: { type: "fresh" } });
    expect(plan.initialInput).toBeUndefined();
    expect(plan.startsAtInputBoundary).toBe(true);
  });

  it("reports safe network query failures without exposing output", async () => {
    const ctx = host();
    vi.mocked(ctx.process.stream!).mockImplementationOnce(processStream("", "fetch failed ECONNRESET SECRET", 1));
    await expect(new GeminiCliAdapter(ctx).generate({ prompt: "secret prompt" })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: "Gemini query failed",
    });
  });

  it("forwards the query timeout and exposes only the safe Host timeout", async () => {
    const ctx = host();
    vi.mocked(ctx.process.stream!).mockImplementationOnce(async function* (_spec, options) {
      expect(options?.timeoutMs).toBe(1_234);
      throw new CliPluginError("PROCESS_TIMEOUT", "Process timed out after 1234ms");
    });
    const error = await new GeminiCliAdapter(ctx).generate({
      prompt: "PROMPT_CANARY",
      timeoutMs: 1_234,
    }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: "PROCESS_TIMEOUT", message: "Process timed out after 1234ms" });
    expect(JSON.stringify(error)).not.toMatch(/PROMPT_CANARY|STDERR_CANARY/);
  });

  it("streams Gemini JSONL events under a Host-managed deny-by-default policy", async () => {
    const ctx = host();
    const writes: Array<{ path: string; contents: string }> = [];
    const unlink = vi.fn(async (policyPath: string) => { void policyPath; });
    ctx.fileSystem!.writeText = (path, contents) => writes.push({ path, contents });
    ctx.fileSystem!.unlink = unlink;
    const fixture = fs.readFileSync(new URL("./fixtures/stream.jsonl", import.meta.url), "utf8");
    vi.mocked(ctx.process.stream!).mockImplementationOnce(processStream(fixture));
    const events = [];
    for await (const event of new GeminiCliAdapter(ctx).stream({
      prompt: "PROMPT_CANARY",
      timeoutMs: 12_345,
      attachments: [{ filename: "image.png", path: "/safe/image.png", mediaType: "image/png" }],
      tools: ["mcp__tower-dev__list_tasks", "mcp__other__blocked"],
      allowedTools: ["mcp__tower-dev__list_tasks"],
    })) events.push(event);

    expect(events).toContainEqual({ type: "session", sessionId: "gemini-session" });
    expect(events).toContainEqual({ type: "reasoning", text: "checking" });
    expect(events).toContainEqual({ type: "text", text: "Hello" });
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool-call", toolCall: expect.objectContaining({ id: "tool-1", name: "mcp__tower-dev__list_tasks" }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool-result", toolResult: expect.objectContaining({ id: "tool-1", name: "mcp__tower-dev__list_tasks" }),
    }));
    expect(writes[0]?.contents).toContain('toolName = "*"\ndecision = "deny"');
    expect(writes[0]?.contents).toContain('mcpName = "tower-dev"');
    expect(ctx.process.stream).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([
        "--output-format", "stream-json", "--admin-policy", expect.stringMatching(
          /^\/tmp\/provider\/assistant-policy-[0-9a-f-]+\.toml$/,
        ),
        "--allowed-mcp-server-names", "tower-dev", "--allowed-tools", "mcp_tower-dev_list_tasks",
      ]),
    }), expect.objectContaining({ timeoutMs: 12_345 }));
    expect(vi.mocked(ctx.process.stream!).mock.calls[0]?.[0].args).toContain("@/safe/image.png\n\nPROMPT_CANARY");
    expect(writes[0]?.contents).not.toContain("blocked");
    expect(unlink).toHaveBeenCalledWith(writes[0]!.path);
  });

  it("isolates concurrent request policy files and removes both after completion", async () => {
    const ctx = host();
    const writes: Array<{ path: string; contents: string }> = [];
    const unlink = vi.fn(async (policyPath: string) => { void policyPath; });
    ctx.fileSystem!.writeText = (path, contents) => writes.push({ path, contents });
    ctx.fileSystem!.unlink = unlink;
    vi.mocked(ctx.process.stream!).mockImplementation(processStream('{"type":"result","status":"success"}\n'));
    const adapter = new GeminiCliAdapter(ctx);
    const consume = async (tool: string) => {
      const events = [];
      for await (const event of adapter.stream({ prompt: tool, tools: [tool], allowedTools: [tool] })) events.push(event);
      return events;
    };

    await Promise.all([
      consume("mcp__tower-one__list_tasks"),
      consume("mcp__tower-two__create_task"),
    ]);

    expect(writes).toHaveLength(2);
    expect(new Set(writes.map((write) => write.path)).size).toBe(2);
    expect(writes.find((write) => write.contents.includes('mcpName = "tower-one"'))?.contents)
      .not.toContain("tower-two");
    expect(writes.find((write) => write.contents.includes('mcpName = "tower-two"'))?.contents)
      .not.toContain("tower-one");
    expect(unlink.mock.calls.map(([policyPath]) => policyPath).sort())
      .toEqual(writes.map((write) => write.path).sort());
  });

  it.each([
    ["error", "PROVIDER_FAILURE"],
    ["abort", "PROCESS_CANCELLED"],
  ] as const)("removes the request policy after a process %s", async (_case, code) => {
    const ctx = host();
    const writes: Array<{ path: string; contents: string }> = [];
    const unlink = vi.fn(async (policyPath: string) => { void policyPath; });
    ctx.fileSystem!.writeText = (policyPath, contents) => writes.push({ path: policyPath, contents });
    ctx.fileSystem!.unlink = unlink;
    vi.mocked(ctx.process.stream!).mockImplementationOnce(async function* () {
      throw new CliPluginError(code, "safe failure");
    });
    const consume = async () => {
      for await (const _event of new GeminiCliAdapter(ctx).stream({ prompt: "test" })) void _event;
    };

    await expect(consume()).rejects.toMatchObject({ code });
    expect(unlink).toHaveBeenCalledWith(writes[0]!.path);
  });

  it.each([
    ["mcp-connected.txt", { installed: true, status: "connected" }],
    ["mcp-pending.txt", { installed: true, status: "pending" }],
    ["mcp-disconnected.txt", { installed: true, status: "disconnected" }],
  ])("derives MCP runtime health from Gemini's first-party %s output", async (fixture, expected) => {
    const ctx = host();
    vi.mocked(ctx.process.execute).mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      stdout: fs.readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8"),
      stderr: "",
      durationMs: 1,
    });
    await expect(new GeminiCliAdapter(ctx).mcp.inspect({ name: "tower-dev" })).resolves.toEqual(expected);
  });

  it("uses stable Gemini MCP and Skills commands through the Host executor", async () => {
    const ctx = host();
    const adapter = new GeminiCliAdapter(ctx);

    await expect(adapter.mcp.install({
      name: "tower",
      command: "node",
      args: ["server.js"],
      env: { TOWER_DATA_DIR: "/tmp/tower" },
      scope: "user",
    })).resolves.toMatchObject({ installed: true });
    await expect(adapter.skills.install({
      name: "tower",
      sourceDir: "/opt/tower/skills/tower",
      scope: "user",
    })).resolves.toMatchObject({ installed: true });

    expect(ctx.process.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          "mcp", "add", "--scope", "user", "--trust",
          "--env", "TOWER_DATA_DIR=/tmp/tower",
          "tower", "node", "server.js",
        ],
      }),
      expect.any(Object),
    );
    expect(ctx.process.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["skills", "install", "/opt/tower/skills/tower", "--scope", "user", "--consent"],
      }),
      expect.any(Object),
    );
  });
});
