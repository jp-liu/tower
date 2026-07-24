// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CliPluginError, type CliAdapter, type CliQueryOptions, type CliQueryResult } from "@tower/ai-sdk";
import type { ResolvedCapabilityTarget } from "../capability-resolver";

const mocks = vi.hoisted(() => ({
  resolveCapabilityPlan: vi.fn(),
  getApiRuntime: vi.fn(),
  recordAttempt: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../capability-resolver", () => ({
  resolveCapabilityPlan: mocks.resolveCapabilityPlan,
  getApiRuntimeForResolvedTarget: mocks.getApiRuntime,
}));
vi.mock("../capability-config-service", () => ({
  recordCapabilityAttemptService: mocks.recordAttempt,
}));

import {
  generateCapabilityStructured,
  generateCapabilityText,
  parseStructuredText,
} from "../capability-executor";

function cliTarget(
  id: string,
  order: number,
  generate: (options: CliQueryOptions) => Promise<CliQueryResult>,
): ResolvedCapabilityTarget {
  return {
    targetId: id,
    connectionId: `connection-${id}`,
    order,
    kind: "cli",
    provider: "fake",
    connectionName: id,
    cli: {
      adapter: { generate } as unknown as CliAdapter,
      provider: {} as ResolvedCapabilityTarget["cli"] extends { provider: infer T } ? T : never,
      commandPath: "/fake/cli",
    },
  };
}

function apiTarget(id: string, order: number): ResolvedCapabilityTarget {
  return {
    targetId: id,
    connectionId: `connection-${id}`,
    modelId: "model",
    order,
    kind: "api",
    provider: "openai",
    connectionName: id,
    api: { protocol: "openai" },
  };
}

function plan(targets: ResolvedCapabilityTarget[]) {
  mocks.resolveCapabilityPlan.mockResolvedValue({ slot: "summary", targets, migrationStatus: "complete" });
}

describe("one-shot capability executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAttempt.mockResolvedValue(undefined);
  });

  it("uses explicit order, forwards CLI options and activity, and records safe diagnostics", async () => {
    const first = vi.fn(async () => { throw new CliPluginError("NETWORK_ERROR", "SECRET_STDERR"); });
    const second = vi.fn(async (options) => {
      expect(options).toMatchObject({ model: "configured-model", maxTurns: 2, maxOutputTokens: 50 });
      return { text: " selected ", reasoning: "thinking", toolCalls: [] };
    });
    const later = cliTarget("later", 3, second);
    later.modelId = "configured-model";
    plan([later, cliTarget("first", 1, first)]);
    const activities: string[] = [];

    await expect(generateCapabilityText({
      slot: "summary",
      prompt: "PROMPT_CANARY",
      cwd: "/work",
      correlationId: "task-1",
      maxTurns: 2,
      maxOutputTokens: 50,
      onActivity: (activity) => activities.push(activity),
    })).resolves.toBe("selected");

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(activities).toEqual(["text", "reasoning"]);
    expect(mocks.recordAttempt.mock.calls.map((call) => call[0].result)).toEqual(["failed", "selected"]);
    const diagnostics = JSON.stringify(mocks.recordAttempt.mock.calls);
    expect(diagnostics).not.toContain("PROMPT_CANARY");
    expect(diagnostics).not.toContain("SECRET_STDERR");
  });

  it("loads API runtime only when an API target is actually selected", async () => {
    plan([
      cliTarget("cli", 0, async () => ({ text: "cli wins" })),
      apiTarget("api", 1),
    ]);
    await expect(generateCapabilityText({ slot: "analysis", prompt: "x", cwd: "/work" }))
      .resolves.toBe("cli wins");
    expect(mocks.getApiRuntime).not.toHaveBeenCalled();
  });

  it("supports API text and normalizes empty output before fallback", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: "", reasoning: "", toolCalls: [], toolResults: [], finishReason: "stop" })
      .mockResolvedValueOnce({ text: "api result", reasoning: "", toolCalls: [], toolResults: [], finishReason: "stop" });
    mocks.getApiRuntime.mockResolvedValue({ generate });
    plan([apiTarget("a", 0), apiTarget("b", 1)]);
    await expect(generateCapabilityText({ slot: "summary", prompt: "x", cwd: "/work" }))
      .resolves.toBe("api result");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(mocks.recordAttempt.mock.calls[0]?.[0]).toMatchObject({ errorCode: "no_output" });
  });

  it("forwards typed API activity to the outer observer", async () => {
    const generate = vi.fn(async (_request, context) => {
      context.onActivity("reasoning");
      context.onActivity("tool_call");
      context.onActivity("tool_result");
      return { text: "done", reasoning: "why", toolCalls: [], toolResults: [], finishReason: "stop" };
    });
    mocks.getApiRuntime.mockResolvedValue({ generate });
    plan([apiTarget("api", 0)]);
    const activities: string[] = [];
    await generateCapabilityText({
      slot: "analysis",
      prompt: "x",
      cwd: "/work",
      onActivity: (activity) => activities.push(activity),
    });
    expect(activities).toEqual(["reasoning", "tool_call", "tool_result", "text"]);
  });

  it("parses one plain or fenced JSON value without extracting multiple objects", () => {
    expect(parseStructuredText("```json\n{\"ok\":true}\n```")).toEqual({ ok: true });
    expect(() => parseStructuredText('{"a":1}\n{"b":2}')).toThrowError(expect.objectContaining({
      code: "structured_output_invalid",
    }));
  });

  it("repairs invalid CLI structured output once on the same target", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: "not json" })
      .mockResolvedValueOnce({ text: "```json\n{\"value\":2}\n```" });
    plan([cliTarget("cli", 0, generate)]);
    await expect(generateCapabilityStructured({
      slot: "dreaming",
      prompt: "return json",
      cwd: "/work",
      schema: { type: "object" },
      parse: (value) => {
        if (!value || typeof value !== "object" || (value as { value?: unknown }).value !== 2) throw new Error();
        return value as { value: number };
      },
    })).resolves.toEqual({ value: 2 });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(mocks.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({ result: "selected", repaired: true }));
  });

  it("uses the next target only after one failed repair", async () => {
    const broken = vi.fn(async () => ({ text: "{}" }));
    const backup = vi.fn(async () => ({ text: '{"valid":true}' }));
    plan([cliTarget("broken", 0, broken), cliTarget("backup", 1, backup)]);
    await expect(generateCapabilityStructured({
      slot: "dreaming",
      prompt: "json",
      cwd: "/work",
      schema: { type: "object" },
      parse: (value) => {
        if ((value as { valid?: boolean }).valid !== true) throw new Error();
        return value;
      },
    })).resolves.toEqual({ valid: true });
    expect(broken).toHaveBeenCalledTimes(2);
    expect(backup).toHaveBeenCalledTimes(1);
  });

  it("blocks fallback when a structured CLI target produced a tool result", async () => {
    const sideEffect = vi.fn(async () => ({
      text: "invalid",
      toolCalls: [{ id: "call", name: "write", output: "done" }],
    }));
    const backup = vi.fn(async () => ({ text: '{"valid":true}' }));
    plan([cliTarget("side-effect", 0, sideEffect), cliTarget("backup", 1, backup)]);
    await expect(generateCapabilityStructured({
      slot: "dreaming",
      prompt: "json",
      cwd: "/work",
      schema: { type: "object" },
      parse: (value) => value,
    })).rejects.toMatchObject({ code: "structured_output_invalid" });
    expect(sideEffect).toHaveBeenCalledTimes(2);
    expect(backup).not.toHaveBeenCalled();
  });

  it("uses native API structured generation and validates its value", async () => {
    const generateStructured = vi.fn(async () => ({ summary: "ok" }));
    mocks.getApiRuntime.mockResolvedValue({ generateStructured });
    plan([apiTarget("api", 0)]);
    await expect(generateCapabilityStructured({
      slot: "dreaming",
      prompt: "json",
      cwd: "/work",
      schema: { type: "object", required: ["summary"] },
      parse: (value) => value as { summary: string },
    })).resolves.toEqual({ summary: "ok" });
    expect(generateStructured).toHaveBeenCalledWith(expect.objectContaining({ modelId: "model" }), expect.any(Object));
  });
});
