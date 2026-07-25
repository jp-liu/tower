// Pure SSE event reducer — no React or DOM dependencies.
// Extracted from use-assistant-chat.ts for testability.

import type { ChatMessage, MessageRole } from "./use-assistant-chat";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SSEEvent {
  type: "session" | "text" | "text_delta" | "reasoning_delta" | "tool_start" | "tool_use" | "tool_result" | "usage" | "finish" | "error" | "done";
  content?: string;
  sessionId?: string;
  toolInput?: unknown;
  toolOutput?: string;
  toolId?: string;
}

export interface ReducerState {
  messages: ChatMessage[];
  assistantMsgId: string | null;
  status: "idle" | "connecting" | "streaming" | "error";
}

// ---------------------------------------------------------------------------
// Pure reducer
// ---------------------------------------------------------------------------

/**
 * Apply a single SSE event to the given reducer state.
 *
 * @param state         Current reducer state (immutable — a new object is returned)
 * @param event         The SSE event received from the server
 * @param thinkingId    ID of the "thinking" placeholder message to remove on updates
 * @param idGenerator   Called when a new message ID is needed (makes the function testable)
 * @returns             New reducer state (never mutates the input)
 */
export function applySSEEvent(
  state: ReducerState,
  event: SSEEvent,
  thinkingId: string,
  idGenerator: () => string
): ReducerState {
  switch (event.type) {
    case "text":
    case "text_delta": {
      // Remove thinking, add/append assistant message
      const filtered = state.messages.filter((m) => m.id !== thinkingId);
      if (state.assistantMsgId) {
        return {
          ...state,
          messages: filtered.map((m) =>
            m.id === state.assistantMsgId
              ? { ...m, content: m.content + (event.content ?? ""), isStreaming: true }
              : m
          ),
        };
      } else {
        const newId = idGenerator();
        return {
          ...state,
          assistantMsgId: newId,
          messages: [
            ...filtered,
            {
              id: newId,
              role: "assistant" as MessageRole,
              content: event.content ?? "",
              isStreaming: true,
            },
          ],
        };
      }
    }

    case "tool_use": {
      const filtered = state.messages.filter((m) => m.id !== thinkingId);
      const updated = state.assistantMsgId
        ? filtered.map((m) =>
            m.id === state.assistantMsgId ? { ...m, isStreaming: false } : m
          )
        : filtered;
      return {
        ...state,
        assistantMsgId: null,
        messages: [
          ...updated,
          {
            id: idGenerator(),
            role: "tool" as MessageRole,
            content: JSON.stringify(event.toolInput ?? {}, null, 2),
            toolName: event.content,
            toolId: event.toolId,
          },
        ],
      };
    }

    case "tool_result": {
      const toolIndex = event.toolId
        ? state.messages.findIndex((message) => message.role === "tool" && message.toolId === event.toolId)
        : -1;
      if (toolIndex >= 0) {
        return {
          ...state,
          messages: state.messages.map((message, index) => index === toolIndex ? {
            ...message,
            content: `${message.content}\n\nResult:\n${String(event.toolOutput ?? "")}`,
            isStreaming: false,
          } : message),
        };
      }
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: idGenerator(),
            role: "tool" as MessageRole,
            content: String(event.toolOutput ?? ""),
            toolName: `${event.content ?? "tool"} (result)`,
          },
        ],
      };
    }

    case "tool_start": {
      if (event.toolId && state.messages.some((message) => message.role === "tool" && message.toolId === event.toolId)) return state;
      return {
        ...state,
        assistantMsgId: null,
        messages: [
          ...state.messages.filter((message) => message.id !== thinkingId),
          {
            id: idGenerator(), role: "tool", content: `Calling ${event.content ?? "tool"}...`,
            toolName: event.content, toolId: event.toolId, isStreaming: true,
          },
        ],
      };
    }

    case "error": {
      return {
        ...state,
        status: "error",
        messages: [
          ...state.messages.filter((m) => m.id !== thinkingId),
          {
            id: idGenerator(),
            role: "assistant" as MessageRole,
            content: `Error: ${event.content ?? "Unknown error"}`,
          },
        ],
      };
    }

    case "done": {
      let msgs = state.messages;
      if (state.assistantMsgId) {
        msgs = msgs.map((m) =>
          m.id === state.assistantMsgId ? { ...m, isStreaming: false } : m
        );
      }
      msgs = msgs.filter((m) => m.id !== thinkingId);
      return {
        ...state,
        status: "idle",
        messages: msgs,
      };
    }

    case "session":
    case "reasoning_delta":
    case "usage":
    case "finish":
      return state;

    default:
      return state;
  }
}
