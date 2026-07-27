import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initDb: vi.fn().mockResolvedValue(undefined),
  updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  recoverClaims: vi.fn().mockResolvedValue(0),
  recoverMissing: vi.fn().mockResolvedValue({
    checkpoint: new Date("2026-07-27T00:00:00.000Z"),
    batches: 0,
    scanned: 0,
    recovered: 0,
    failed: 0,
    remaining: 0,
    truncated: false,
    skipped: false,
  }),
  reap: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/db", () => ({
  initDb: mocks.initDb,
  db: { taskExecution: { updateMany: mocks.updateMany } },
}));

vi.mock("@/lib/workbench/coordinator", () => ({
  recoverWorkbenchEventClaims: mocks.recoverClaims,
  recoverMissingWorkbenchExecutionEvents: mocks.recoverMissing,
}));

vi.mock("@/lib/pty/orphan-reaper", () => ({ reapOrphanedProcesses: mocks.reap }));
vi.mock("@/lib/logger", () => ({
  logger: { create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { cleanupStaleExecutions } from "@/lib/instrumentation-tasks";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Workbench instrumentation recovery", () => {
  it("recovers stale claims before scanning for missing execution events", async () => {
    await cleanupStaleExecutions();

    expect(mocks.recoverClaims).toHaveBeenCalledOnce();
    expect(mocks.recoverMissing).toHaveBeenCalledOnce();
    expect(mocks.recoverClaims.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recoverMissing.mock.invocationCallOrder[0],
    );
  });
});
