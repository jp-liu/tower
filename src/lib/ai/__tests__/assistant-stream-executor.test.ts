// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CliPluginError, type CliQueryEvent, type CliQueryOptions } from "@tower/ai-sdk";
import type { ResolvedCapabilityTarget } from "../capability-resolver";

const mocks = vi.hoisted(() => ({
  resolvePlan: vi.fn(),
  getApiRuntime: vi.fn(),
  createTools: vi.fn(() => ({ tower_tool: { inputSchema: {} } })),
  preparePrompt: vi.fn(async ({ prompt }: { prompt: string }) => prompt),
}));

vi.mock("server-only", () => ({}));
vi.mock("../capability-resolver", () => ({
  resolveCapabilityPlan: mocks.resolvePlan,
  getApiRuntimeForResolvedTarget: mocks.getApiRuntime,
}));
vi.mock("../assistant-tool-bundle", () => ({
  createAssistantToolBundle: mocks.createTools,
  prepareAssistantCliPrompt: mocks.preparePrompt,
}));
vi.mock("@/mcp/tool-catalog", () => ({
  assistantTowerToolCatalog: { list_tasks: {}, create_task: {} },
}));

import { streamAssistantTurn } from "../assistant-stream-executor";

function cliTarget(
  id: string,
  order: number,
  stream: (options: CliQueryOptions) => AsyncIterable<CliQueryEvent>,
): ResolvedCapabilityTarget {
  return {
    targetId: id,
    connectionId: `connection-${id}`,
    order,
    kind: "cli",
    provider: "fake",
    connectionName: id,
    cli: {
      adapter: {
        stream,
        generate: vi.fn(),
        buildSessionProcess: vi.fn(),
        models: vi.fn(),
        mcp: {
          inspect: vi.fn(async () => ({ installed: true })),
          install: vi.fn(),
          uninstall: vi.fn(),
        },
      },
      provider: {} as never,
      commandPath: "/fake/cli",
    },
  };
}

async function collect(targets: ResolvedCapabilityTarget[]) {
  mocks.resolvePlan.mockResolvedValue({ slot: "assistant", targets, migrationStatus: "complete" });
  const events: CliQueryEvent[] = [];
  for await (const event of streamAssistantTurn({
    prompt: "PROMPT_CANARY",
    cwd: "/work",
    towerMcpServerName: "tower-dev",
  })) events.push(event);
  return events;
}

describe("Assistant stream executor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("falls back before activity and forwards the dynamic Tower MCP name", async () => {
    const first = vi.fn(async function* (_options?: unknown) {
      void _options;
      throw new CliPluginError("NETWORK_ERROR", "SECRET_STDERR");
    });
    const second = vi.fn(async function* (_options?: unknown) {
      void _options;
      yield { type: "session" as const, sessionId: "s2" };
      yield { type: "text" as const, text: "selected" };
      yield { type: "finish" as const, reason: "stop" };
    });
    const attempts = vi.fn();
    mocks.resolvePlan.mockResolvedValue({
      slot: "assistant",
      targets: [cliTarget("first", 0, first), cliTarget("second", 1, second)],
      migrationStatus: "complete",
    });
    const events = [];
    for await (const event of streamAssistantTurn({
      prompt: "PROMPT_CANARY", cwd: "/work", towerMcpServerName: "tower-dev", onAttempt: attempts,
    })) events.push(event);

    expect(events).toEqual([
      { type: "session", sessionId: "s2" },
      { type: "text", text: "selected" },
      { type: "finish", reason: "stop" },
    ]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    const options = second.mock.calls[0]?.[0] as CliQueryOptions;
    expect(options.tools).toEqual([
      "mcp__tower-dev__list_tasks",
      "mcp__tower-dev__create_task",
    ]);
    expect(options.timeoutMs).toBe(300_000);
    expect(JSON.stringify(attempts.mock.calls)).not.toMatch(/PROMPT_CANARY|SECRET_STDERR/);
  });

  it("never switches targets after the first text activity", async () => {
    const first = vi.fn(async function* () {
      yield { type: "text" as const, text: "partial" };
      yield { type: "usage" as const, usage: { inputTokens: 1, outputTokens: 2 } };
      throw new CliPluginError("NETWORK_ERROR", "private failure");
    });
    const backup = vi.fn(async function* () { yield { type: "text" as const, text: "duplicate" }; });
    const events = await collect([cliTarget("first", 0, first), cliTarget("backup", 1, backup)]);
    expect(events[0]).toEqual({ type: "text", text: "partial" });
    expect(events[1]).toEqual({ type: "usage", usage: { inputTokens: 1, outputTokens: 2 } });
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "network" } });
    expect(backup).not.toHaveBeenCalled();
  });

  it("returns tooling_unavailable before provider output when MCP is absent", async () => {
    const target = cliTarget("cli", 0, vi.fn(async function* () { yield { type: "text" as const, text: "wrong" }; }));
    vi.mocked(target.cli!.adapter.mcp!.inspect).mockResolvedValue({ installed: false });
    const events = await collect([target]);
    expect(events).toEqual([expect.objectContaining({
      type: "error",
      error: expect.objectContaining({ code: "tooling_unavailable" }),
    })]);
  });

  it.each(["pending", "disconnected"] as const)(
    "returns tooling_unavailable before provider output when MCP is %s",
    async (status) => {
      const stream = vi.fn(async function* () { yield { type: "text" as const, text: "wrong" }; });
      const target = cliTarget("cli", 0, stream);
      vi.mocked(target.cli!.adapter.mcp!.inspect).mockResolvedValue({ installed: true, status });
      const events = await collect([target]);
      expect(events).toEqual([expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "tooling_unavailable" }),
      })]);
      expect(stream).not.toHaveBeenCalled();
    },
  );

  it("clamps the request timeout and returns only a safe timeout error", async () => {
    const stream = vi.fn(async function* (options: CliQueryOptions) {
      expect(options.timeoutMs).toBe(1_000);
      throw new CliPluginError("PROCESS_TIMEOUT", "PRIVATE_TIMEOUT_DETAIL");
    });
    const target = cliTarget("cli", 0, stream);
    const controller = new AbortController();
    mocks.resolvePlan.mockResolvedValue({ slot: "assistant", targets: [target], migrationStatus: "complete" });
    const events = [];
    for await (const event of streamAssistantTurn({
      prompt: "PROMPT_CANARY",
      cwd: "/work",
      timeoutMs: 1,
      signal: controller.signal,
      towerMcpServerName: "tower-dev",
    })) events.push(event);
    expect(events).toEqual([expect.objectContaining({
      type: "error",
      error: expect.objectContaining({ code: "timeout", message: "The upstream request timed out" }),
    })]);
    expect(target.cli!.adapter.mcp!.inspect).toHaveBeenCalledWith(expect.objectContaining({
      signal: controller.signal,
      timeoutMs: 1_000,
    }));
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE_TIMEOUT_DETAIL|PROMPT_CANARY/);
  });

  it.each(["claude", "codex", "gemini"])(
    "applies the same restricted attachment preparation before starting %s",
    async (provider) => {
      const stream = vi.fn(async function* () { yield { type: "finish" as const, reason: "stop" }; });
      const target = cliTarget(provider, 0, stream);
      target.provider = provider;
      mocks.resolvePlan.mockResolvedValue({ slot: "assistant", targets: [target], migrationStatus: "complete" });
      mocks.preparePrompt.mockRejectedValueOnce(new Error("PRIVATE_ATTACHMENT_PATH"));
      const events = [];
      for await (const event of streamAssistantTurn({
        prompt: "PROMPT_CANARY",
        cwd: "/work",
        attachments: ["2026-07/files/note.txt"],
        towerMcpServerName: "tower-dev",
      })) events.push(event);
      expect(events).toEqual([expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "attachment_unavailable" }),
      })]);
      expect(stream).not.toHaveBeenCalled();
      expect(JSON.stringify(events)).not.toMatch(/PRIVATE_ATTACHMENT_PATH|PROMPT_CANARY/);
    },
  );

  it("loads an API runtime only when its explicit target executes", async () => {
    const target: ResolvedCapabilityTarget = {
      targetId: "api", connectionId: "api-connection", modelId: "model", order: 0,
      kind: "api", provider: "openai", connectionName: "API", api: { protocol: "openai" },
    };
    const apiStream = vi.fn(async function* () {
        yield { type: "tool-call", call: { toolCallId: "c1", toolName: "list_tasks", input: {} } };
        yield { type: "tool-result", result: { toolCallId: "c1", toolName: "list_tasks", output: [] } };
        yield { type: "text", delta: "done" };
        yield { type: "usage", usage: { inputTokens: 1, outputTokens: 2 } };
        yield { type: "finish", finishReason: "stop" };
    });
    mocks.getApiRuntime.mockResolvedValue({ stream: apiStream });
    const events = await collect([target]);
    expect(events.map((event) => event.type)).toEqual([
      "tool-call", "tool-result", "text", "usage", "finish",
    ]);
    expect(mocks.getApiRuntime).toHaveBeenCalledWith(target);
    expect(mocks.createTools).toHaveBeenCalledTimes(1);
    expect(apiStream).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 300_000 }), expect.any(Object));
  });
});
