// @vitest-environment node
// This test file is intentionally empty.
// The adapter process-manager (canStartExecution, runningProcesses) was removed in Phase 29
// as part of adapter dead-code cleanup. Task execution is now fully handled by the
// PTY session layer (src/lib/pty-session.ts) with no per-execution concurrency gate.
import { describe, it } from "vitest";

describe("process-manager (removed)", () => {
  it.todo("adapter process-manager deleted in Phase 29 — tests no longer applicable");
});
