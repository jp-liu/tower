// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  normalizeOpenClawTaskStatus,
  parseOpenClawTaskOutput,
  parseOpenClawTaskSnapshot,
} from "../openclaw-task-client";

describe("OpenClaw capability Job reconciliation", () => {
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
