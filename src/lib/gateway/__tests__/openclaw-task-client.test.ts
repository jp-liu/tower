// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  findOpenClawTaskInList,
  openClawProcessEnv,
  normalizeOpenClawTaskStatus,
  parseOpenClawTaskOutput,
  parseOpenClawTaskSnapshot,
} from "../openclaw-task-client";

it("forces machine-readable OpenClaw output when the parent enables colors", () => {
  const previous = process.env.FORCE_COLOR;
  const previousVitest = process.env.VITEST;
  const previousNodeEnv = process.env.NODE_ENV;
  const mutableProcessEnv = process.env as Record<string, string | undefined>;
  process.env.FORCE_COLOR = "1";
  process.env.VITEST = "true";
  mutableProcessEnv.NODE_ENV = "test";
  try {
    const env = openClawProcessEnv({});
    expect(env.FORCE_COLOR).toBeUndefined();
    expect(env.NO_COLOR).toBe("1");
    expect(env.CLICOLOR).toBe("0");
    expect(env.VITEST).toBeUndefined();
    expect(env.NODE_ENV).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = previous;
    if (previousVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = previousVitest;
    if (previousNodeEnv === undefined) delete mutableProcessEnv.NODE_ENV;
    else mutableProcessEnv.NODE_ENV = previousNodeEnv;
  }
});

describe("OpenClaw capability Job reconciliation", () => {
  it("resolves a subagent runId through a task-list response", () => {
    expect(findOpenClawTaskInList("run-1", {
      count: 2,
      tasks: [
        { taskId: "task-2", runId: "run-2" },
        { taskId: "task-1", runId: "run-1", status: "succeeded" },
      ],
    })).toMatchObject({ taskId: "task-1", runId: "run-1" });
    expect(findOpenClawTaskInList("missing", { tasks: [] })).toBeNull();
  });

  it.each([
    ["queued", "ACCEPTED"],
    ["running", "RUNNING"],
    ["succeeded", "SUCCEEDED"],
    ["failed", "FAILED"],
    ["cancelled", "CANCELLED"],
    ["timed_out", "EXPIRED"],
    ["lost", "SIDE_EFFECT_UNKNOWN"],
    ["future_status", "SIDE_EFFECT_UNKNOWN"],
  ])("normalizes %s conservatively", (source, expected) => {
    expect(normalizeOpenClawTaskStatus(source)).toBe(expected);
  });

  it("uses lastEventAt as a monotonic revision and keeps only a safe summary", () => {
    const snapshot = parseOpenClawTaskSnapshot("run-1", {
      taskId: "task-1",
      runId: "run-1",
      status: "succeeded",
      lastEventAt: 1_785_602_262_048,
      terminalSummary: "completed",
      task: "sensitive full prompt",
      requesterSessionKey: "private-session",
    });

    expect(snapshot).toEqual({
      gateway: "openclaw",
      requestedRef: "run-1",
      jobRef: "task-1",
      runId: "run-1",
      status: "SUCCEEDED",
      revision: "1785602262048",
      updatedAt: new Date(1_785_602_262_048).toISOString(),
      summary: "completed",
    });
  });

  it("rejects records without an authoritative revision", () => {
    expect(() => parseOpenClawTaskSnapshot("run-1", {
      taskId: "task-1",
      status: "running",
    })).toThrow(/revision timestamp/);
  });

  it("accepts OpenClaw migration notes only before the complete JSON value", () => {
    const parsed = parseOpenClawTaskOutput(
      "[state-migrations] Legacy state migration notes:\n- retained sidecar\n" +
      "{\n  \"taskId\": \"task-1\",\n  \"status\": \"running\"\n}\n",
    );

    expect(parsed).toEqual({ taskId: "task-1", status: "running" });
    expect(() => parseOpenClawTaskOutput(
      "notice\n{\"taskId\":\"task-1\"}\ntrailing garbage",
    )).toThrow(/non-JSON task response/);
  });
});
