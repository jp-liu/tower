// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// We import the module under test — module-level Map persists within a test file
import {
  registerPreviewProcess,
  killPreviewProcess,
  isPreviewRunning,
} from "@/lib/preview-process";

import type { ChildProcess } from "node:child_process";

/** Create a fake ChildProcess with controllable state */
function makeFakeChild(killed = false): ChildProcess {
  return {
    killed,
    kill: vi.fn(),
    pid: Math.floor(Math.random() * 10000),
  } as unknown as ChildProcess;
}

// Clear any registered processes between tests by killing them all
beforeEach(() => {
  // Stop any lingering processes from previous tests
  // We use a known taskId list approach — just call kill on common IDs
  killPreviewProcess("task-1");
  killPreviewProcess("task-2");
  killPreviewProcess("task-3");
  killPreviewProcess("task-unknown");
});

describe("registerPreviewProcess", () => {
  it("stores the process so isPreviewRunning returns true", () => {
    const child = makeFakeChild();
    registerPreviewProcess("task-1", child);
    expect(isPreviewRunning("task-1")).toBe(true);
  });

  it("overwrites an existing process for the same taskId", () => {
    const child1 = makeFakeChild();
    const child2 = makeFakeChild();
    registerPreviewProcess("task-1", child1);
    registerPreviewProcess("task-1", child2);
    // Still running (child2 is alive)
    expect(isPreviewRunning("task-1")).toBe(true);
    // Clean up
    killPreviewProcess("task-1");
  });
});

describe("isPreviewRunning", () => {
  it("returns false for unknown taskId", () => {
    expect(isPreviewRunning("task-unknown")).toBe(false);
  });

  it("returns true when process is registered and not killed", () => {
    const child = makeFakeChild(false);
    registerPreviewProcess("task-1", child);
    expect(isPreviewRunning("task-1")).toBe(true);
  });

  it("returns false when process has been killed externally", () => {
    const child = makeFakeChild(true);
    registerPreviewProcess("task-1", child);
    expect(isPreviewRunning("task-1")).toBe(false);
  });
});

describe("killPreviewProcess", () => {
  it("returns false for unknown taskId", () => {
    const result = killPreviewProcess("task-unknown");
    expect(result).toBe(false);
  });

  it("calls kill(SIGTERM), removes from map, and returns true for a live process", () => {
    const child = makeFakeChild(false);
    registerPreviewProcess("task-1", child);

    const result = killPreviewProcess("task-1");

    expect(result).toBe(true);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    // Process removed from map
    expect(isPreviewRunning("task-1")).toBe(false);
  });

  it("returns false (not re-killed) when process is already killed", () => {
    const child = makeFakeChild(true); // already killed
    registerPreviewProcess("task-2", child);

    const result = killPreviewProcess("task-2");

    // Removed from map, but kill() not called because already killed
    expect(result).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("after killing, isPreviewRunning returns false", () => {
    const child = makeFakeChild(false);
    registerPreviewProcess("task-3", child);

    killPreviewProcess("task-3");

    expect(isPreviewRunning("task-3")).toBe(false);
  });
});
