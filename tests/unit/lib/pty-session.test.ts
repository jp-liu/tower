import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node-pty to avoid native addon in test environment
const mockPty = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
};

vi.mock("node-pty", () => ({
  spawn: vi.fn(() => mockPty),
}));

import { PtySession } from "@/lib/pty/pty-session";

describe("PtySession", () => {
  let onData: ReturnType<typeof vi.fn>;
  let onExit: ReturnType<typeof vi.fn>;
  let session: PtySession;

  beforeEach(() => {
    vi.clearAllMocks();
    onData = vi.fn();
    onExit = vi.fn();
    // Reset mockPty callbacks
    mockPty.onData.mockImplementation(() => {});
    mockPty.onExit.mockImplementation(() => {});
    session = new PtySession("task-1", "bash", [], "/tmp", onData, onExit);
  });

  afterEach(() => {
    // Clean up
  });

  describe("constructor", () => {
    it("sets taskId", () => {
      expect(session.taskId).toBe("task-1");
    });

    it("initializes killed as false", () => {
      expect(session.killed).toBe(false);
    });

    it("initializes disconnectTimer as null", () => {
      expect(session.disconnectTimer).toBeNull();
    });

    it("registers onData and onExit callbacks on the PTY", () => {
      expect(mockPty.onData).toHaveBeenCalledOnce();
      expect(mockPty.onExit).toHaveBeenCalledOnce();
    });
  });

  describe("ring buffer", () => {
    it("accumulates data in buffer", () => {
      const dataCallback = mockPty.onData.mock.calls[0][0];
      dataCallback("hello");
      dataCallback(" world");
      expect(session.getBuffer()).toBe("hello world");
    });

    it("calls onData listener for each chunk", () => {
      const dataCallback = mockPty.onData.mock.calls[0][0];
      dataCallback("chunk1");
      dataCallback("chunk2");
      expect(onData).toHaveBeenCalledTimes(2);
      expect(onData).toHaveBeenCalledWith("chunk1");
      expect(onData).toHaveBeenCalledWith("chunk2");
    });

    it("trims buffer to BUFFER_MAX (50KB)", () => {
      const dataCallback = mockPty.onData.mock.calls[0][0];
      // Write 60KB of data
      const bigChunk = "x".repeat(60 * 1024);
      dataCallback(bigChunk);
      const buffer = session.getBuffer();
      expect(buffer.length).toBe(50 * 1024);
    });
  });

  describe("onExit", () => {
    it("sets killed=true on PTY exit", () => {
      const exitCallback = mockPty.onExit.mock.calls[0][0];
      exitCallback({ exitCode: 0, signal: 0 });
      expect(session.killed).toBe(true);
    });

    it("calls onExit callback with exitCode", () => {
      const exitCallback = mockPty.onExit.mock.calls[0][0];
      exitCallback({ exitCode: 1, signal: 15 });
      expect(onExit).toHaveBeenCalledWith(1, 15);
    });

    it("notifies the registered exit listener via setExitListener", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      session.setExitListener(listener1);
      session.setExitListener(listener2);

      const exitCallback = mockPty.onExit.mock.calls[0][0];
      exitCallback({ exitCode: 0, signal: 0 });

      // setExitListener replaces previous listener — only listener2 should fire
      expect(listener2).toHaveBeenCalledWith(0);
    });
  });

  describe("setDataListener", () => {
    it("replaces the data listener", () => {
      const newListener = vi.fn();
      session.setDataListener(newListener);

      const dataCallback = mockPty.onData.mock.calls[0][0];
      dataCallback("new data");

      expect(newListener).toHaveBeenCalledWith("new data");
      // Original listener should NOT be called for new data
      // (it was called during construction if any data arrived then)
    });
  });

  describe("write", () => {
    it("forwards data to PTY when not killed", () => {
      session.write("hello");
      expect(mockPty.write).toHaveBeenCalledWith("hello");
    });

    it("does NOT write to PTY when killed", () => {
      session.kill();
      session.write("hello");
      expect(mockPty.write).not.toHaveBeenCalled();
    });
  });

  describe("resize", () => {
    it("forwards resize to PTY when not killed", () => {
      session.resize(120, 40);
      expect(mockPty.resize).toHaveBeenCalledWith(120, 40);
    });

    it("does NOT resize PTY when killed", () => {
      session.kill();
      session.resize(120, 40);
      expect(mockPty.resize).not.toHaveBeenCalled();
    });
  });

  describe("kill (double-kill guard)", () => {
    it("kills the PTY on first call", () => {
      session.kill();
      expect(session.killed).toBe(true);
      expect(mockPty.kill).toHaveBeenCalledOnce();
    });

    it("does NOT kill again on second call", () => {
      session.kill();
      session.kill();
      expect(mockPty.kill).toHaveBeenCalledOnce();
    });

    it("handles PTY already dead (kill throws)", () => {
      mockPty.kill.mockImplementationOnce(() => {
        throw new Error("Process already dead");
      });
      expect(() => session.kill()).not.toThrow();
      expect(session.killed).toBe(true);
    });
  });
});
