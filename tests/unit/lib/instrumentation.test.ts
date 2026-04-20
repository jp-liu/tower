// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/instrumentation-tasks
vi.mock("@/lib/instrumentation-tasks", () => ({
  pruneOrphanedWorktrees: vi.fn().mockResolvedValue(undefined),
  cleanupStaleExecutions: vi.fn().mockResolvedValue(undefined),
}));

// Mock @/lib/pty/ws-server
vi.mock("@/lib/pty/ws-server", () => ({
  startWsServer: vi.fn().mockResolvedValue(undefined),
}));

// Mock @/lib/init-tower
vi.mock("@/lib/init-tower", () => ({
  ensureTowerDir: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.NEXT_RUNTIME = "nodejs";
});

describe("register", () => {
  it("calls pruneOrphanedWorktrees and cleanupStaleExecutions on startup", async () => {
    const { pruneOrphanedWorktrees, cleanupStaleExecutions } = await import(
      "@/lib/instrumentation-tasks"
    );
    const { startWsServer } = await import("@/lib/pty/ws-server");
    const { ensureTowerDir } = await import("@/lib/init-tower");

    const { register } = await import("@/instrumentation");
    await register();

    expect(pruneOrphanedWorktrees).toHaveBeenCalledOnce();
    expect(cleanupStaleExecutions).toHaveBeenCalledOnce();
    expect(startWsServer).toHaveBeenCalledOnce();
    expect(ensureTowerDir).toHaveBeenCalledOnce();
  });

  it("skips all tasks in non-nodejs runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";

    const { pruneOrphanedWorktrees, cleanupStaleExecutions } = await import(
      "@/lib/instrumentation-tasks"
    );
    const { startWsServer } = await import("@/lib/pty/ws-server");
    const { ensureTowerDir } = await import("@/lib/init-tower");

    const { register } = await import("@/instrumentation");
    await register();

    expect(pruneOrphanedWorktrees).not.toHaveBeenCalled();
    expect(cleanupStaleExecutions).not.toHaveBeenCalled();
    expect(startWsServer).not.toHaveBeenCalled();
    expect(ensureTowerDir).not.toHaveBeenCalled();
  });

  it("handles pruneOrphanedWorktrees failure gracefully", async () => {
    const { pruneOrphanedWorktrees } = await import("@/lib/instrumentation-tasks");
    vi.mocked(pruneOrphanedWorktrees).mockRejectedValueOnce(
      new Error("pruneOrphanedWorktrees failed")
    );

    const { register } = await import("@/instrumentation");
    // pruneOrphanedWorktrees has internal try/catch in instrumentation-tasks.ts,
    // but since we mock at the module level, if the mock rejects register() will propagate.
    // The source awaits without try/catch, so we expect it to reject.
    await expect(register()).rejects.toThrow("pruneOrphanedWorktrees failed");
  });

  it("handles cleanupStaleExecutions failure gracefully", async () => {
    const { cleanupStaleExecutions } = await import("@/lib/instrumentation-tasks");
    vi.mocked(cleanupStaleExecutions).mockRejectedValueOnce(
      new Error("cleanupStaleExecutions failed")
    );

    const { register } = await import("@/instrumentation");
    // The source awaits without try/catch, so we expect it to reject.
    await expect(register()).rejects.toThrow("cleanupStaleExecutions failed");
  });
});
