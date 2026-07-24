// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writes: string[] = [];

vi.mock("node-pty", () => ({
  spawn: vi.fn(() => ({
    pid: 123,
    write: (value: string) => writes.push(value),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
  })),
}));

import { PtySession } from "../pty-session";

describe("PTY initial input", () => {
  beforeEach(() => {
    writes.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  it("writes the body and standalone submit key exactly once after spawn", async () => {
    const session = new PtySession("task", "gemini", [], "/work", () => {}, () => {});
    const prompt = `line one\nline 'two' ${"x".repeat(10_000)}`;

    session.writeInitialInput(prompt);
    session.writeInitialInput("must not be sent");
    await vi.advanceTimersByTimeAsync(150);

    expect(writes).toEqual([prompt, "\r"]);
  });
});
