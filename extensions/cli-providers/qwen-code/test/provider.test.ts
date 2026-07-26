import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { CliHostContext, CliProcessStreamEvent } from "@tower-org/ai-sdk";
import { QwenCodeAdapter, qwenManifest } from "../src/index.js";

function host(events: CliProcessStreamEvent[] = []) {
  const execute = vi.fn();
  const stream = vi.fn(async function* () {
    for (const event of events) yield event;
  });
  const context: CliHostContext = {
    platform: "linux",
    arch: "x64",
    storageDir: "/tmp/qwen-provider",
    signal: new AbortController().signal,
    resources: { homeDir: "/tmp", commandPath: "/opt/bin/qwen" },
    process: { execute, stream },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };
  return { context, execute, stream };
}

function stdout(value: unknown): CliProcessStreamEvent {
  return { type: "stdout", chunk: new TextEncoder().encode(`${JSON.stringify(value)}\n`) };
}

describe("Qwen Code community provider", () => {
  it("keeps the package manifest and public SDK manifest aligned", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(packageJson.tower).toEqual(qwenManifest);
    expect(packageJson.dependencies).toEqual({ "@tower-org/ai-sdk": "workspace:*" });
    expect(qwenManifest.cliDependency).toMatchObject({
      name: "Qwen Code CLI",
      supportedVersions: ">=0.18.0 <1.0.0",
      managedByTower: false,
    });
    expect(qwenManifest.capabilities.integrations).toEqual({ mcp: false, hooks: false, skills: false });
    const staticRegistry = await readFile(
      new URL("../../../../src/lib/ai/providers/index.ts", import.meta.url),
      "utf8",
    );
    expect(staticRegistry).not.toContain("qwen");
    expect(staticRegistry).not.toContain("community.qwen-code");
  });

  it("builds official interactive, resume, continue, and Hello process arguments", () => {
    const { context } = host();
    const adapter = new QwenCodeAdapter(context);
    expect(adapter.buildSessionProcess({
      prompt: "start",
      cwd: "/work",
      mode: { type: "fresh" },
      systemPrompt: "system",
      model: "qwen3-coder-plus",
    })).toEqual({
      command: "/opt/bin/qwen",
      args: ["--append-system-prompt", "system", "--model", "qwen3-coder-plus"],
      cwd: "/work",
      envPatch: undefined,
      initialInput: "start",
    });
    expect(adapter.buildSessionProcess({
      prompt: "resume",
      cwd: "/work",
      mode: { type: "resume", sessionId: "session-1" },
    }).args).toEqual(["--resume", "session-1"]);
    expect(adapter.buildSessionProcess({
      prompt: "continue",
      cwd: "/work",
      mode: { type: "continue" },
    }).args).toEqual(["--continue"]);
    expect(adapter.buildHelloProbe({ command: "/opt/bin/qwen", cwd: "/work", prompt: "hello" }))
      .toEqual({
        command: "/opt/bin/qwen",
        args: ["--prompt", "hello", "--output-format", "json"],
        cwd: "/work",
      });
  });

  it("maps documented stream-json messages into the public query contract", async () => {
    const { context, stream } = host([
      stdout({ type: "system", subtype: "session_start", session_id: "qwen-session" }),
      stdout({
        type: "assistant",
        session_id: "qwen-session",
        message: { content: [{ type: "text", text: "Qwen result" }] },
      }),
      stdout({
        type: "result",
        subtype: "success",
        session_id: "qwen-session",
        is_error: false,
        usage: { input_tokens: 10, output_tokens: 3, cached_input_tokens: 2 },
      }),
      { type: "exit", exitCode: 0, signal: null, durationMs: 4 },
    ]);
    const result = await new QwenCodeAdapter(context).generate({
      prompt: "summarize",
      cwd: "/work",
      model: "qwen3-coder-plus",
      maxTurns: 4,
    });
    expect(result).toMatchObject({
      text: "Qwen result",
      sessionId: "qwen-session",
      usage: { inputTokens: 10, outputTokens: 3, cachedInputTokens: 2 },
      finishReason: "success",
    });
    expect(stream).toHaveBeenCalledWith({
      command: "/opt/bin/qwen",
      args: [
        "--prompt", "summarize",
        "--output-format", "stream-json",
        "--model", "qwen3-coder-plus",
        "--max-session-turns", "4",
      ],
      cwd: "/work",
    }, expect.any(Object));
  });

  it("does not claim Tower tool or attachment mappings", async () => {
    const adapter = new QwenCodeAdapter(host().context);
    await expect(adapter.generate({ prompt: "tools", tools: ["mcp__tower__list_tasks"] }))
      .rejects.toMatchObject({ code: "TOOLING_UNAVAILABLE" });
    await expect(adapter.generate({
      prompt: "image",
      attachments: [{ filename: "x.png", path: "/tmp/x.png", mediaType: "image/png" }],
    })).rejects.toMatchObject({ code: "ATTACHMENT_UNAVAILABLE" });
  });
});
