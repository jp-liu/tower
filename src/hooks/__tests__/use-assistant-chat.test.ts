import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// useAssistantChat hook
// ---------------------------------------------------------------------------
// The hook now uses SSE (Server-Sent Events) via fetch() to communicate with
// the Agent SDK backend. It no longer parses raw PTY/WebSocket output.
//
// Unit tests here verify the exported types and message structure.
// Integration tests require a running server (manual/E2E).
// ---------------------------------------------------------------------------

describe("useAssistantChat types", () => {
  it("exports expected types", async () => {
    const mod = await import("../use-assistant-chat");
    expect(typeof mod.useAssistantChat).toBe("function");
    // Type-only exports verified by TypeScript compilation
  });
});

describe("ChatMessage shape", () => {
  it("has the expected role values", () => {
    const roles: Array<import("../use-assistant-chat").MessageRole> = [
      "user",
      "assistant",
      "thinking",
      "tool",
    ];
    expect(roles).toHaveLength(4);
    for (const role of roles) {
      expect(typeof role).toBe("string");
    }
  });
});
