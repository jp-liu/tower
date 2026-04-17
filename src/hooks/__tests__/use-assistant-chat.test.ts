import { describe, it, expect } from "vitest";
import { stripAnsi } from "../use-assistant-chat";
import type { ChatMessage } from "../use-assistant-chat";

// ---------------------------------------------------------------------------
// Helper: simulate the parser state machine in isolation
// We expose parseLines as a named export for testing purposes.
// ---------------------------------------------------------------------------
import { parseLines } from "../use-assistant-chat";

// ---------------------------------------------------------------------------
// stripAnsi
// ---------------------------------------------------------------------------
describe("stripAnsi", () => {
  it("removes CSI color codes", () => {
    expect(stripAnsi("\x1B[31mhello\x1B[0m")).toBe("hello");
  });

  it("removes complex CSI sequences", () => {
    expect(stripAnsi("\x1B[1;32mgreen bold\x1B[0m")).toBe("green bold");
  });

  it("removes cursor movement sequences", () => {
    expect(stripAnsi("\x1B[2A\x1B[80Dtext")).toBe("text");
  });

  it("removes OSC sequences (title setting)", () => {
    expect(stripAnsi("\x1B]0;window title\x07rest")).toBe("rest");
  });

  it("removes OSC sequences ending with ST", () => {
    expect(stripAnsi("\x1B]2;title\x1B\\rest")).toBe("rest");
  });

  it("passes through clean text unchanged", () => {
    expect(stripAnsi("normal text")).toBe("normal text");
    expect(stripAnsi("")).toBe("");
  });

  it("handles mixed ANSI + clean text", () => {
    expect(stripAnsi("hello \x1B[31mworld\x1B[0m")).toBe("hello world");
  });

  it("handles ESC-only sequences (two-character forms)", () => {
    // ESC followed by single char in range [@-Z\-_]
    expect(stripAnsi("\x1BM text")).toBe(" text");
  });
});

// ---------------------------------------------------------------------------
// parseLines — state machine
// ---------------------------------------------------------------------------
describe("parseLines", () => {
  it("returns empty array for empty input", () => {
    const { messages } = parseLines([], "", []);
    expect(messages).toEqual([]);
  });

  it("accumulates assistant text lines into one message", () => {
    const lines = ["Hello there.", "How can I help?"];
    const { messages } = parseLines([], "", lines);
    const assistant = messages.filter((m) => m.role === "assistant");
    expect(assistant.length).toBe(1);
    expect(assistant[0].content).toContain("Hello there.");
    expect(assistant[0].content).toContain("How can I help?");
  });

  it("detects user prompt line starting with >", () => {
    const lines = ["> What is Tower?"];
    const { messages } = parseLines([], "", lines);
    const user = messages.find((m) => m.role === "user");
    expect(user).toBeTruthy();
    expect(user!.content).toContain("What is Tower?");
  });

  it("detects user prompt line starting with ❯", () => {
    const lines = ["❯ Create a task"];
    const { messages } = parseLines([], "", lines);
    const user = messages.find((m) => m.role === "user");
    expect(user).toBeTruthy();
    expect(user!.content).toContain("Create a task");
  });

  it("creates thinking message for lines with hourglass character", () => {
    const lines = ["⏳ Thinking..."];
    const { messages } = parseLines([], "", lines);
    const thinking = messages.find((m) => m.role === "thinking");
    expect(thinking).toBeTruthy();
    expect(thinking!.isStreaming).toBe(true);
  });

  it("creates thinking message for spinner patterns", () => {
    const lines = ["⠋ Processing request"];
    const { messages } = parseLines([], "", lines);
    const thinking = messages.find((m) => m.role === "thinking");
    expect(thinking).toBeTruthy();
  });

  it("creates tool message for Tool: prefix", () => {
    const lines = ["Tool: list_tasks"];
    const { messages } = parseLines([], "", lines);
    const tool = messages.find((m) => m.role === "tool");
    expect(tool).toBeTruthy();
    expect(tool!.toolName).toBe("list_tasks");
  });

  it("handles box-drawing boundary ╭ as message boundary", () => {
    const lines = ["First assistant message", "╭─────────────────╮", "Second part"];
    const { messages } = parseLines([], "", lines);
    // Should have produced messages — at minimum one assistant segment before the boundary
    expect(messages.length).toBeGreaterThan(0);
  });

  it("each message has a unique id", () => {
    const lines = ["> User question", "Assistant answer", "⏳ Thinking"];
    const { messages } = parseLines([], "", lines);
    const ids = messages.map((m) => m.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("accumulates consecutive assistant lines (no duplicate message per line)", () => {
    const lines = ["Line one", "Line two", "Line three"];
    const { messages } = parseLines([], "", lines);
    const assistant = messages.filter((m) => m.role === "assistant");
    // All lines should merge into at most 1 assistant message
    expect(assistant.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Partial chunk buffering
// ---------------------------------------------------------------------------
describe("partial chunk buffering", () => {
  it("buffers incomplete line until newline arrives", () => {
    // parseLines helper accepts (existingMessages, lineBuffer, newLines)
    // Simulate receiving "hel" — no complete line yet, buffer holds it
    const result1 = parseLines([], "hel", []);
    expect(result1.messages).toEqual([]);
    expect(result1.buffer).toBe("hel");
  });

  it("processes buffered content when newline arrives", () => {
    // First call: partial line
    const r1 = parseLines([], "", []);
    // Second call: simulate buffer "Hello" + new chunk "lo\nworld\n"
    // The hook splits on \n: complete lines get passed to parseLines
    // We test that "Hello" followed by complete lines works
    const lines = ["Hello", "world"];
    const r2 = parseLines(r1.messages, r1.buffer, lines);
    const assistant = r2.messages.filter((m) => m.role === "assistant");
    expect(assistant.length).toBe(1);
    expect(assistant[0].content).toContain("Hello");
    expect(assistant[0].content).toContain("world");
  });

  it("appends to existing messages when called incrementally", () => {
    const r1 = parseLines([], "", ["First line"]);
    expect(r1.messages.filter((m) => m.role === "assistant").length).toBe(1);

    // Add more assistant lines — they should extend the last assistant message
    const r2 = parseLines(r1.messages, r1.buffer, ["Second line"]);
    const assistant = r2.messages.filter((m) => m.role === "assistant");
    expect(assistant.length).toBe(1);
    expect(assistant[0].content).toContain("First line");
    expect(assistant[0].content).toContain("Second line");
  });
});

// ---------------------------------------------------------------------------
// ChatMessage type shape
// ---------------------------------------------------------------------------
describe("ChatMessage type", () => {
  it("has required fields: id, role, content", () => {
    const lines = ["Hello"];
    const { messages } = parseLines([], "", lines);
    expect(messages.length).toBeGreaterThan(0);
    for (const msg of messages) {
      expect(typeof msg.id).toBe("string");
      expect(msg.id.length).toBeGreaterThan(0);
      expect(["user", "assistant", "thinking", "tool"]).toContain(msg.role);
      expect(typeof msg.content).toBe("string");
    }
  });
});
