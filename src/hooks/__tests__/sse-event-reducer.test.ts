// @vitest-environment node

import { describe, it, expect, beforeEach } from "vitest";
import { applySSEEvent } from "../sse-event-reducer";
import type { ReducerState, SSEEvent } from "../sse-event-reducer";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let counter = 0;
const idGen = () => `id-${counter++}`;

const THINKING_ID = "thinking-id";

function makeState(overrides?: Partial<ReducerState>): ReducerState {
  return {
    messages: [],
    assistantMsgId: null,
    status: "streaming",
    ...overrides,
  };
}

beforeEach(() => {
  counter = 0;
});

// ---------------------------------------------------------------------------
// type="text"
// ---------------------------------------------------------------------------

describe("applySSEEvent — type='text'", () => {
  it("creates a new assistant message when no prior assistant message exists", () => {
    const state = makeState({
      messages: [{ id: THINKING_ID, role: "thinking", content: "", isStreaming: true }],
    });
    const event: SSEEvent = { type: "text", content: "Hello" };

    const next = applySSEEvent(state, event, THINKING_ID, idGen);

    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].role).toBe("assistant");
    expect(next.messages[0].content).toBe("Hello");
    expect(next.messages[0].isStreaming).toBe(true);
    expect(next.assistantMsgId).toBe("id-0");
  });

  it("appends content to the existing assistant message", () => {
    const state = makeState({
      messages: [
        { id: THINKING_ID, role: "thinking", content: "", isStreaming: true },
        { id: "asst-1", role: "assistant", content: "Hello", isStreaming: true },
      ],
      assistantMsgId: "asst-1",
    });
    const event: SSEEvent = { type: "text", content: " World" };

    const next = applySSEEvent(state, event, THINKING_ID, idGen);

    const asst = next.messages.find((m) => m.id === "asst-1");
    expect(asst?.content).toBe("Hello World");
    expect(asst?.isStreaming).toBe(true);
    expect(next.assistantMsgId).toBe("asst-1");
  });

  it("removes the thinking message when processing text", () => {
    const state = makeState({
      messages: [
        { id: "user-1", role: "user", content: "Hi" },
        { id: THINKING_ID, role: "thinking", content: "", isStreaming: true },
      ],
    });
    const event: SSEEvent = { type: "text", content: "Response" };

    const next = applySSEEvent(state, event, THINKING_ID, idGen);

    const thinkingMsg = next.messages.find((m) => m.id === THINKING_ID);
    expect(thinkingMsg).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// type="tool_use"
// ---------------------------------------------------------------------------

describe("applySSEEvent — type='tool_use'", () => {
  it("adds a tool message with JSON-stringified toolInput", () => {
    const state = makeState({
      messages: [{ id: THINKING_ID, role: "thinking", content: "", isStreaming: true }],
    });
    const event: SSEEvent = {
      type: "tool_use",
      content: "read_file",
      toolInput: { path: "/src/index.ts" },
    };

    const next = applySSEEvent(state, event, THINKING_ID, idGen);

    const toolMsg = next.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.content).toBe(JSON.stringify({ path: "/src/index.ts" }, null, 2));
    expect(toolMsg?.toolName).toBe("read_file");
  });

  it("finalizes (isStreaming=false) the current assistant message", () => {
    const state = makeState({
      messages: [
        { id: "asst-1", role: "assistant", content: "Here is the file:", isStreaming: true },
        { id: THINKING_ID, role: "thinking", content: "", isStreaming: true },
      ],
      assistantMsgId: "asst-1",
    });
    const event: SSEEvent = { type: "tool_use", content: "read_file", toolInput: {} };

    const next = applySSEEvent(state, event, THINKING_ID, idGen);

    const asst = next.messages.find((m) => m.id === "asst-1");
    expect(asst?.isStreaming).toBe(false);
    expect(next.assistantMsgId).toBeNull();
  });

  it("removes thinking message when processing tool_use", () => {
    const state = makeState({
      messages: [{ id: THINKING_ID, role: "thinking", content: "", isStreaming: true }],
    });
    const event: SSEEvent = { type: "tool_use", content: "bash", toolInput: { cmd: "ls" } };

    const next = applySSEEvent(state, event, THINKING_ID, idGen);

    expect(next.messages.find((m) => m.id === THINKING_ID)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// type="tool_result"
// ---------------------------------------------------------------------------

describe("applySSEEvent — type='tool_result'", () => {
  it("appends a tool result message", () => {
    const state = makeState({
      messages: [{ id: "tool-1", role: "tool", content: "{}", toolName: "bash" }],
    });
    const event: SSEEvent = {
      type: "tool_result",
      content: "bash",
      toolOutput: "file1.ts\nfile2.ts",
    };

    const next = applySSEEvent(state, event, THINKING_ID, idGen);

    expect(next.messages).toHaveLength(2);
    const resultMsg = next.messages[1];
    expect(resultMsg.role).toBe("tool");
    expect(resultMsg.content).toBe("file1.ts\nfile2.ts");
    expect(resultMsg.toolName).toBe("bash (result)");
  });

  it("appends tool result with empty toolOutput when missing", () => {
    const state = makeState({ messages: [] });
    const event: SSEEvent = { type: "tool_result", content: "some_tool" };

    const next = applySSEEvent(state, event, THINKING_ID, idGen);

    expect(next.messages[0].content).toBe("");
    expect(next.messages[0].toolName).toBe("some_tool (result)");
  });
});

// ---------------------------------------------------------------------------
// type="error"
// ---------------------------------------------------------------------------

describe("applySSEEvent — type='error'", () => {
  it("removes thinking and adds an error assistant message", () => {
    const state = makeState({
      messages: [
        { id: "user-1", role: "user", content: "Hi" },
        { id: THINKING_ID, role: "thinking", content: "", isStreaming: true },
      ],
    });
    const event: SSEEvent = { type: "error", content: "Rate limit exceeded" };

    const next = applySSEEvent(state, event, THINKING_ID, idGen);

    expect(next.messages.find((m) => m.id === THINKING_ID)).toBeUndefined();
    const errMsg = next.messages.find((m) => m.role === "assistant");
    expect(errMsg?.content).toBe("Error: Rate limit exceeded");
    expect(next.status).toBe("error");
  });

  it("uses 'Unknown error' when content is missing", () => {
    const state = makeState({
      messages: [{ id: THINKING_ID, role: "thinking", content: "", isStreaming: true }],
    });
    const event: SSEEvent = { type: "error" };

    const next = applySSEEvent(state, event, THINKING_ID, idGen);

    const errMsg = next.messages.find((m) => m.role === "assistant");
    expect(errMsg?.content).toBe("Error: Unknown error");
  });
});

// ---------------------------------------------------------------------------
// type="done"
// ---------------------------------------------------------------------------

describe("applySSEEvent — type='done'", () => {
  it("marks assistant message as not streaming and removes thinking", () => {
    const state = makeState({
      messages: [
        { id: "asst-1", role: "assistant", content: "Done talking", isStreaming: true },
        { id: THINKING_ID, role: "thinking", content: "", isStreaming: true },
      ],
      assistantMsgId: "asst-1",
    });
    const event: SSEEvent = { type: "done" };

    const next = applySSEEvent(state, event, THINKING_ID, idGen);

    const asst = next.messages.find((m) => m.id === "asst-1");
    expect(asst?.isStreaming).toBe(false);
    expect(next.messages.find((m) => m.id === THINKING_ID)).toBeUndefined();
    expect(next.status).toBe("idle");
  });

  it("just removes thinking when there is no assistant message", () => {
    const state = makeState({
      messages: [
        { id: "user-1", role: "user", content: "Hi" },
        { id: THINKING_ID, role: "thinking", content: "", isStreaming: true },
      ],
      assistantMsgId: null,
    });
    const event: SSEEvent = { type: "done" };

    const next = applySSEEvent(state, event, THINKING_ID, idGen);

    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].role).toBe("user");
    expect(next.status).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// unknown event type
// ---------------------------------------------------------------------------

describe("applySSEEvent — unknown event type", () => {
  it("returns state unchanged for unknown event types", () => {
    const state = makeState({
      messages: [{ id: "user-1", role: "user", content: "Hi" }],
      assistantMsgId: null,
    });
    // Cast to bypass TypeScript type narrowing for testing unknown types
    const event = { type: "unknown_event_type" } as unknown as SSEEvent;

    const next = applySSEEvent(state, event, THINKING_ID, idGen);

    expect(next).toEqual(state);
  });
});
