import { describe, expect, it, vi } from "vitest";
import {
  AI_CAPABILITY_SLOTS,
  CapabilityRuntimeError,
  capabilityError,
  executeTerminalPrestartFallback,
  executeWithCapabilityFallback,
  resolveFixedTerminalTarget,
  streamWithCapabilityFallback,
  normalizeCapabilityError,
  type CapabilityAttemptSummary,
  type CapabilityTarget,
} from "../src/index.js";

const targets: CapabilityTarget[] = [
  { targetId: "target-a", connectionId: "connection-a", modelId: "model-a", order: 0 },
  { targetId: "target-b", connectionId: "connection-b", modelId: "model-b", order: 1 },
];

describe("capability slots", () => {
  it("contains exactly the five supported slots", () => {
    expect(AI_CAPABILITY_SLOTS).toEqual([
      "terminal",
      "summary",
      "dreaming",
      "analysis",
      "assistant",
    ]);
  });
});

describe("explicit capability fallback", () => {
  it("normalizes legacy adapter codes without inspecting unsafe messages", () => {
    expect(normalizeCapabilityError({ code: "RATE_LIMITED", message: "PROMPT_CANARY" }))
      .toMatchObject({ code: "rate_limit", message: "The upstream service rate limit was reached" });
  });

  it.each([
    ["COMMAND_NOT_EXECUTABLE", "cli_not_executable"],
    ["PROCESS_TIMEOUT", "timeout"],
    ["PROCESS_CANCELLED", "cancelled"],
    ["QUERY_FAILED", "provider_failure"],
    ["AUTHENTICATION_FAILED", "authentication"],
    ["PERMISSION_DENIED", "permission"],
    ["CONTENT_SAFETY", "content_safety"],
    ["INVALID_REQUEST", "invalid_request"],
    ["TOOL_ERROR", "tool_error"],
    ["TOOLING_UNAVAILABLE", "tooling_unavailable"],
  ] as const)("maps CLI query code %s to %s", (rawCode, expected) => {
    expect(normalizeCapabilityError({ code: rawCode, message: "SECRET_OUTPUT" })).toMatchObject({
      code: expected,
    });
    expect(JSON.stringify(normalizeCapabilityError({ code: rawCode, message: "SECRET_OUTPUT" })))
      .not.toContain("SECRET_OUTPUT");
  });

  it("does not invent a target for an empty slot", async () => {
    await expect(executeWithCapabilityFallback({
      requestId: "request",
      slot: "assistant",
      targets: [],
      execute: vi.fn(),
    })).rejects.toMatchObject({ code: "slot_unconfigured", attempts: [] });
  });

  it.each([
    "connection_disabled",
    "connection_unavailable",
    "cli_not_found",
    "cli_not_executable",
    "spawn_failed",
    "authentication",
    "permission",
    "rate_limit",
    "network",
    "timeout",
    "model_unavailable",
    "no_output",
    "provider_failure",
  ] as const)("uses the next explicit target for pre-activity %s", async (code) => {
    const calls: string[] = [];
    const result = await executeWithCapabilityFallback({
      requestId: "request",
      slot: "summary",
      targets,
      execute: async (target) => {
        calls.push(target.targetId);
        if (target.targetId === "target-a") throw capabilityError(code);
        return "ok";
      },
    });
    expect(result).toBe("ok");
    expect(calls).toEqual(["target-a", "target-b"]);
  });

  it.each([
    "cancelled",
    "content_safety",
    "invalid_request",
    "tool_error",
    "unknown",
  ] as const)("does not fall back for %s", async (code) => {
    const execute = vi.fn(async () => { throw capabilityError(code); });
    await expect(executeWithCapabilityFallback({
      requestId: "request",
      slot: "assistant",
      targets,
      execute,
    })).rejects.toMatchObject({ code });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not fall back after the first activity", async () => {
    const execute = vi.fn(async (_target: CapabilityTarget, context: { onActivity: (kind: "tool_call") => void }) => {
      context.onActivity("tool_call");
      throw capabilityError("rate_limit");
    });
    await expect(executeWithCapabilityFallback({
      requestId: "request",
      slot: "assistant",
      targets,
      execute,
    })).rejects.toMatchObject({ code: "rate_limit" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("skips an explicitly unavailable model with a diagnostic attempt", async () => {
    const attempts: CapabilityAttemptSummary[] = [];
    const result = await executeWithCapabilityFallback({
      requestId: "request",
      slot: "analysis",
      targets: [
        { ...targets[0]!, preflightError: { code: "model_unavailable", message: "safe" } },
        targets[1]!,
      ],
      execute: async () => "ok",
      onAttempt: (attempt) => { attempts.push(attempt); },
    });
    expect(result).toBe("ok");
    expect(attempts.map(({ result: status, errorCode }) => [status, errorCode])).toEqual([
      ["skipped", "model_unavailable"],
      ["selected", undefined],
    ]);
  });

  it("repairs structured output once before using a backup", async () => {
    const execute = vi.fn(async () => { throw capabilityError("structured_output_invalid"); });
    const repair = vi.fn(async (target: CapabilityTarget) => {
      if (target.targetId === "target-a") throw capabilityError("structured_output_invalid");
      return { valid: true };
    });
    const result = await executeWithCapabilityFallback({
      requestId: "request",
      slot: "analysis",
      targets,
      execute,
      repair,
    });
    expect(result).toEqual({ valid: true });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(repair).toHaveBeenCalledTimes(2);
  });

  it("never includes thrown secrets in aggregate errors or attempts", async () => {
    const canaries = ["PROMPT_CANARY", "KEY_CANARY", "HEADER_CANARY", "QUERY_CANARY", "BODY_CANARY"];
    let caught: unknown;
    try {
      await executeWithCapabilityFallback({
        requestId: "request",
        correlationId: "correlation",
        slot: "summary",
        targets,
        execute: async () => { throw new Error(canaries.join(" ")); },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CapabilityRuntimeError);
    const serialized = JSON.stringify(caught);
    for (const canary of canaries) expect(serialized).not.toContain(canary);
  });

  it("does not let a diagnostic storage failure change the selected result", async () => {
    const result = await executeWithCapabilityFallback({
      requestId: "request",
      slot: "summary",
      targets: [targets[0]!],
      execute: async () => "ok",
      onAttempt: async () => { throw new Error("diagnostic database unavailable"); },
    });
    expect(result).toBe("ok");
  });
});

describe("stream activity boundary", () => {
  it("falls back before events and stops after the first output event", async () => {
    const calls: string[] = [];
    const beforeOutput = async function* (target: CapabilityTarget) {
      calls.push(target.targetId);
      if (target.targetId === "target-a") throw capabilityError("network");
      yield { type: "text", delta: "ok" };
    };
    const events = [];
    for await (const event of streamWithCapabilityFallback({
      requestId: "request",
      slot: "assistant",
      targets,
      execute: beforeOutput,
    })) events.push(event);
    expect(events).toEqual([{ type: "text", delta: "ok" }]);
    expect(calls).toEqual(["target-a", "target-b"]);

    const afterOutput = async function* () {
      yield { type: "reasoning", delta: "started" };
      throw capabilityError("network");
    };
    await expect(async () => {
      for await (const event of streamWithCapabilityFallback({
        requestId: "request-2",
        slot: "assistant",
        targets,
        execute: afterOutput,
      })) void event;
    }).rejects.toMatchObject({ code: "network" });
  });
});

describe("terminal helpers", () => {
  it("only falls back for pre-session startup failures", async () => {
    const calls: string[] = [];
    const selected = await executeTerminalPrestartFallback({
      requestId: "request",
      targets,
      execute: async (target) => {
        calls.push(target.targetId);
        if (target.targetId === "target-a") throw capabilityError("spawn_failed");
        return target.connectionId;
      },
    });
    expect(selected).toBe("connection-b");
    expect(calls).toEqual(["target-a", "target-b"]);

    await expect(executeTerminalPrestartFallback({
      requestId: "request-2",
      targets,
      execute: async () => { throw capabilityError("authentication"); },
    })).rejects.toMatchObject({ code: "authentication" });
  });

  it("never switches connections after session creation activity", async () => {
    const execute = vi.fn(async (_target: CapabilityTarget, context: { onActivity: (kind: "side_effect") => void }) => {
      context.onActivity("side_effect");
      throw capabilityError("spawn_failed");
    });
    await expect(executeTerminalPrestartFallback({
      requestId: "request-after-session",
      targets,
      execute,
    })).rejects.toMatchObject({ code: "spawn_failed" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("resolves an existing session only by its fixed connection", () => {
    expect(resolveFixedTerminalTarget(targets, "connection-b").targetId).toBe("target-b");
    expect(() => resolveFixedTerminalTarget(targets, "missing")).toThrowError(/unavailable/i);
  });
});
