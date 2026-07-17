import { describe, it, expect, beforeEach } from "vitest";
import { parkSession, unparkSession } from "../session-store";

// parkSession/unparkSession only touch the shared PtySession object in the
// globalThis session map, so a minimal fake with the fields the keepalive gate
// reads is enough — no real PTY spawn needed.
type FakeSession = { taskId: string; killed: boolean; parked: boolean; disconnectTimer: ReturnType<typeof setTimeout> | null };

function putFake(taskId: string, s: Partial<FakeSession>): FakeSession {
  const g = globalThis as typeof globalThis & { __ptySessions?: Map<string, unknown> };
  if (!g.__ptySessions) g.__ptySessions = new Map();
  const fake: FakeSession = { taskId, killed: false, parked: false, disconnectTimer: null, ...s };
  g.__ptySessions.set(taskId, fake);
  return fake;
}

describe("park/unpark keepalive gating", () => {
  beforeEach(() => {
    (globalThis as { __ptySessions?: Map<string, unknown> }).__ptySessions?.clear();
  });

  it("park sets the flag and cancels an already-ticking disconnect timer", () => {
    const timer = setTimeout(() => { throw new Error("keepalive fired while parked"); }, 100_000);
    const s = putFake("cparkaaaaaaaaaaaaaaaaaaaa", { disconnectTimer: timer });
    parkSession(s.taskId);
    expect(s.parked).toBe(true);
    expect(s.disconnectTimer).toBeNull();
  });

  it("unpark clears the flag so normal keepalive resumes", () => {
    const s = putFake("cparkbbbbbbbbbbbbbbbbbbbb", { parked: true });
    unparkSession(s.taskId);
    expect(s.parked).toBe(false);
  });

  it("park is a no-op on a dead session (nothing to keep alive)", () => {
    const s = putFake("cparkcccccccccccccccccccc", { killed: true });
    parkSession(s.taskId);
    expect(s.parked).toBe(false);
  });
});
