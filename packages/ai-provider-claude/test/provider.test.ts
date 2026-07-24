import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { isCliPluginManifestV1, type CliHostContext } from "@tower/ai-sdk";
import { ClaudeCliAdapter, claudeManifest, towerCliPlugin } from "../src/index.js";

function host(): CliHostContext {
  return {
    platform: "linux",
    arch: "x64",
    storageDir: "/tmp/tower-provider-test",
    signal: new AbortController().signal,
    process: { execute: vi.fn(async () => ({ exitCode: 0, signal: null, stdout: "ok", stderr: "", durationMs: 1 })) },
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
    expect(adapter.buildSessionProcess({ prompt: "ignored", cwd: "/work", mode: { type: "resume", sessionId: "s-1" } }).args)
      .toEqual(["--dangerously-skip-permissions", "--resume", "s-1"]);
    expect(adapter.buildSessionProcess({ prompt: "ignored", cwd: "/work", mode: { type: "continue" } }).args)
      .toEqual(["--dangerously-skip-permissions", "--continue"]);
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
    vi.mocked(ctx.process.execute)
      .mockResolvedValueOnce({ exitCode: 1, signal: null, stdout: "", stderr: "401 unauthorized SECRET", durationMs: 1 })
      .mockResolvedValueOnce({ exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1 });
    const adapter = new ClaudeCliAdapter(ctx);
    await expect(adapter.generate({ prompt: "secret prompt" })).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED",
      message: "Claude query failed",
    });
    await expect(adapter.generate({ prompt: "secret prompt" })).rejects.toMatchObject({ code: "NO_OUTPUT" });
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
