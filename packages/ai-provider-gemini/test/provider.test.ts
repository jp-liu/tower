import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { isCliPluginManifestV1, type CliAdapter, type CliHostContext } from "@tower/ai-sdk";
import { GeminiCliAdapter, geminiManifest } from "../src/index.js";

function host(): CliHostContext {
  return {
    platform: "linux", arch: "x64", storageDir: "/tmp/provider", signal: new AbortController().signal,
    process: { execute: vi.fn(async () => ({ exitCode: 0, signal: null, stdout: "", stderr: "", durationMs: 1 })) },
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
  });

  it("maps resume and continue to Gemini 0.38 semantics without initial input", () => {
    const adapter = new GeminiCliAdapter(host());
    const resume = adapter.buildSessionProcess({ prompt: "ignored", cwd: "/work", mode: { type: "resume", sessionId: "7" } });
    const latest = adapter.buildSessionProcess({ prompt: "ignored", cwd: "/work", mode: { type: "continue" } });
    expect(resume.args).toEqual(["--yolo", "--resume", "7"]);
    expect(latest.args).toEqual(["--yolo", "--resume", "latest"]);
    expect(resume.initialInput).toBeUndefined();
    expect(latest.initialInput).toBeUndefined();
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
