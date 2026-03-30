// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock config-reader before importing process-manager
vi.mock("@/lib/config-reader", () => ({
  readConfigValue: vi.fn(),
}));

// Mock process-utils to control runningProcesses
vi.mock("@/lib/adapters/process-utils", () => ({
  runningProcesses: new Map(),
}));

import { readConfigValue } from "@/lib/config-reader";
import { runningProcesses } from "@/lib/adapters/process-utils";
import { canStartExecution } from "@/lib/adapters/process-manager";

const mockedReadConfigValue = vi.mocked(readConfigValue);

beforeEach(() => {
  vi.clearAllMocks();
  runningProcesses.clear();
});

describe("canStartExecution", () => {
  it("is async and returns a Promise", async () => {
    mockedReadConfigValue.mockResolvedValue(3);
    const result = canStartExecution();
    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  it("resolves to true when running count is less than configured max", async () => {
    mockedReadConfigValue.mockResolvedValue(3);
    // 0 running, max 3 → should allow
    const result = await canStartExecution();
    expect(result).toBe(true);
  });

  it("resolves to true when running count is below max", async () => {
    mockedReadConfigValue.mockResolvedValue(3);
    // Add 2 running processes, max is 3
    runningProcesses.set("run-1", { child: {} as never, graceSec: 5 });
    runningProcesses.set("run-2", { child: {} as never, graceSec: 5 });
    const result = await canStartExecution();
    expect(result).toBe(true);
  });

  it("resolves to false when running count equals configured max", async () => {
    mockedReadConfigValue.mockResolvedValue(3);
    // Add 3 running processes, max is 3
    runningProcesses.set("run-1", { child: {} as never, graceSec: 5 });
    runningProcesses.set("run-2", { child: {} as never, graceSec: 5 });
    runningProcesses.set("run-3", { child: {} as never, graceSec: 5 });
    const result = await canStartExecution();
    expect(result).toBe(false);
  });

  it("resolves to false when running count exceeds configured max", async () => {
    mockedReadConfigValue.mockResolvedValue(2);
    // Add 3 running processes, max is 2
    runningProcesses.set("run-1", { child: {} as never, graceSec: 5 });
    runningProcesses.set("run-2", { child: {} as never, graceSec: 5 });
    runningProcesses.set("run-3", { child: {} as never, graceSec: 5 });
    const result = await canStartExecution();
    expect(result).toBe(false);
  });

  it("uses the configured max from config-reader", async () => {
    mockedReadConfigValue.mockResolvedValue(1);
    // Max is 1, 1 running → should reject
    runningProcesses.set("run-1", { child: {} as never, graceSec: 5 });
    const result = await canStartExecution();
    expect(result).toBe(false);
    expect(mockedReadConfigValue).toHaveBeenCalledWith("system.maxConcurrentExecutions", 3);
  });
});
