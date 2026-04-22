import { describe, it, expect } from "vitest";
import {
  convertSessionMessages,
  type SDKSessionMessage,
} from "../assistant-message-converter";

function makeMsg(
  type: "user" | "assistant" | "system",
  message: unknown,
  uuid = crypto.randomUUID()
): SDKSessionMessage {
  return { type, uuid, session_id: "test-session", message, parent_tool_use_id: null };
}

describe("convertSessionMessages", () => {
  it("should convert user messages", () => {
    const msgs = [makeMsg("user", { content: "Hello" })];
    const result = convertSessionMessages(msgs);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("Hello");
  });

  it("should strip /tower prefix from user messages", () => {
    const msgs = [makeMsg("user", { content: "/tower 帮我创建任务" })];
    const result = convertSessionMessages(msgs);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("帮我创建任务");
  });

  it("should convert assistant text messages", () => {
    const msgs = [
      makeMsg("assistant", {
        content: [{ type: "text", text: "Hi there!" }],
      }),
    ];
    const result = convertSessionMessages(msgs);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toBe("Hi there!");
  });

  it("should concatenate multiple text blocks in one assistant message", () => {
    const msgs = [
      makeMsg("assistant", {
        content: [
          { type: "text", text: "Part 1. " },
          { type: "text", text: "Part 2." },
        ],
      }),
    ];
    const result = convertSessionMessages(msgs);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Part 1. Part 2.");
  });

  it("should convert tool_use blocks as separate tool messages", () => {
    const msgs = [
      makeMsg("assistant", {
        content: [
          { type: "text", text: "Let me check." },
          { type: "tool_use", name: "list_tasks", input: { projectId: "abc" } },
        ],
      }),
    ];
    const result = convertSessionMessages(msgs);

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toBe("Let me check.");
    expect(result[1].role).toBe("tool");
    expect(result[1].toolName).toBe("list_tasks");
  });

  it("should skip system messages", () => {
    const msgs = [
      makeMsg("user", { content: "Hello" }),
      makeMsg("system", { subtype: "compact_boundary" }),
      makeMsg("assistant", { content: [{ type: "text", text: "Hi" }] }),
    ];
    const result = convertSessionMessages(msgs);

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
  });

  it("should handle empty input", () => {
    expect(convertSessionMessages([])).toEqual([]);
  });

  it("should handle tool_result in system messages", () => {
    const msgs = [
      makeMsg("user", { content: "List tasks" }),
      makeMsg("assistant", {
        content: [
          { type: "tool_use", name: "list_tasks", input: {} },
        ],
      }),
      makeMsg("system", {
        subtype: "tool_result",
        tool_name: "list_tasks",
        content: '[{"id":"1","title":"Task 1"}]',
      }),
    ];
    const result = convertSessionMessages(msgs);

    // user + tool_use + tool_result
    expect(result).toHaveLength(3);
    expect(result[2].role).toBe("tool");
    expect(result[2].toolName).toContain("list_tasks");
  });

  it("should handle assistant message with only tool_use (no text)", () => {
    const msgs = [
      makeMsg("assistant", {
        content: [
          { type: "tool_use", name: "search", input: { query: "test" } },
        ],
      }),
    ];
    const result = convertSessionMessages(msgs);

    // Only tool message, no empty assistant message
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("tool");
    expect(result[0].toolName).toBe("search");
  });

  it("should handle a full multi-turn conversation", () => {
    const msgs = [
      makeMsg("user", { content: "Show my tasks" }),
      makeMsg("assistant", {
        content: [
          { type: "text", text: "I'll look that up." },
          { type: "tool_use", name: "list_tasks", input: { projectId: "p1" } },
        ],
      }),
      makeMsg("system", {
        subtype: "tool_result",
        tool_name: "list_tasks",
        content: "Found 3 tasks",
      }),
      makeMsg("assistant", {
        content: [{ type: "text", text: "You have 3 tasks." }],
      }),
    ];
    const result = convertSessionMessages(msgs);

    expect(result.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
      "assistant",
    ]);
  });
});
