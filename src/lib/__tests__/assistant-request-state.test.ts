import { describe, expect, it } from "vitest";
import { AssistantRequestState, settleAssistantMessages } from "../assistant-request-state";

describe("AssistantRequestState", () => {
  it("rejects a late A history response after B becomes active", () => {
    const state = new AssistantRequestState();
    const a = state.beginHistory("session-a");
    const b = state.beginHistory("session-b");
    expect(state.isCurrentHistory(a, "session-b")).toBe(false);
    expect(state.isCurrentHistory(b, "session-b")).toBe(true);
  });

  it("rejects buffered SSE events after switching sessions", () => {
    const state = new AssistantRequestState();
    const a = state.beginStream("session-a");
    state.cancelStream();
    const b = state.beginStream("session-b");
    expect(state.acceptsStreamEvent(a, "session-b", "session-a")).toBe(false);
    expect(state.acceptsStreamEvent(b, "session-b", "session-b")).toBe(true);
  });

  it("binds a new request to its first Tower session event and rejects another id", () => {
    const state = new AssistantRequestState();
    const token = state.beginStream(null);
    expect(state.acceptsStreamEvent(token, null, "session-new")).toBe(true);
    expect(state.acceptsStreamEvent(token, "session-new")).toBe(true);
    expect(state.acceptsStreamEvent(token, "session-new", "session-other")).toBe(false);
  });

  it("settles cancel/close UI state without discarding completed messages", () => {
    expect(settleAssistantMessages([
      { role: "user", isStreaming: false, content: "kept" },
      { role: "tool", isStreaming: true, content: "result" },
      { role: "thinking", isStreaming: true, content: "" },
    ])).toEqual([
      { role: "user", isStreaming: false, content: "kept" },
      { role: "tool", isStreaming: false, content: "result" },
    ]);
  });
});
