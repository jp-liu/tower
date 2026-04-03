import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node-pty
const mockPty = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
};

vi.mock("node-pty", () => ({
  spawn: vi.fn(() => ({
    ...mockPty,
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  })),
}));

import {
  createSession,
  getSession,
  destroySession,
  destroyAllSessions,
} from "@/lib/pty/session-store";

describe("session-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clean up any sessions from previous tests
    destroyAllSessions();
  });

  describe("createSession", () => {
    it("creates a new PtySession and returns it", () => {
      const session = createSession("task-1", "bash", [], "/tmp", vi.fn(), vi.fn());
      expect(session).toBeDefined();
      expect(session.taskId).toBe("task-1");
    });

    it("stores session retrievable by getSession", () => {
      const session = createSession("task-2", "bash", [], "/tmp", vi.fn(), vi.fn());
      const retrieved = getSession("task-2");
      expect(retrieved).toBe(session);
    });

    it("destroys existing session before creating new one for same taskId", () => {
      const session1 = createSession("task-3", "bash", [], "/tmp", vi.fn(), vi.fn());
      const killSpy = vi.spyOn(session1, "kill");

      createSession("task-3", "bash", [], "/tmp", vi.fn(), vi.fn());
      expect(killSpy).toHaveBeenCalled();
    });
  });

  describe("getSession", () => {
    it("returns undefined for non-existent taskId", () => {
      expect(getSession("non-existent")).toBeUndefined();
    });

    it("returns the session for existing taskId", () => {
      const session = createSession("task-4", "bash", [], "/tmp", vi.fn(), vi.fn());
      expect(getSession("task-4")).toBe(session);
    });
  });

  describe("destroySession", () => {
    it("removes session from store", () => {
      createSession("task-5", "bash", [], "/tmp", vi.fn(), vi.fn());
      destroySession("task-5");
      expect(getSession("task-5")).toBeUndefined();
    });

    it("kills the PTY", () => {
      const session = createSession("task-6", "bash", [], "/tmp", vi.fn(), vi.fn());
      const killSpy = vi.spyOn(session, "kill");
      destroySession("task-6");
      expect(killSpy).toHaveBeenCalled();
    });

    it("clears disconnect timer if set", () => {
      const session = createSession("task-7", "bash", [], "/tmp", vi.fn(), vi.fn());
      session.disconnectTimer = setTimeout(() => {}, 30000);
      destroySession("task-7");
      expect(session.disconnectTimer).toBeNull();
    });

    it("does nothing for non-existent taskId", () => {
      expect(() => destroySession("non-existent")).not.toThrow();
    });
  });

  describe("destroyAllSessions", () => {
    it("destroys all sessions", () => {
      const s1 = createSession("task-a", "bash", [], "/tmp", vi.fn(), vi.fn());
      const s2 = createSession("task-b", "bash", [], "/tmp", vi.fn(), vi.fn());
      const kill1 = vi.spyOn(s1, "kill");
      const kill2 = vi.spyOn(s2, "kill");

      destroyAllSessions();

      expect(kill1).toHaveBeenCalled();
      expect(kill2).toHaveBeenCalled();
      expect(getSession("task-a")).toBeUndefined();
      expect(getSession("task-b")).toBeUndefined();
    });
  });
});
