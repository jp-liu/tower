// Pure SSE event reducer — no React or DOM dependencies.
// Extracted from use-assistant-chat.ts for testability.

import type { ChatMessage, MessageRole } from "./use-assistant-chat";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SSEEvent {
  type: "text" | "tool_use" | "tool_result" | "error" | "done";
  content?: string;
  sessionId?: string;
  toolInput?: unknown;
  toolOutput?: string;
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
    case "text": {
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
          },
        ],
      };
    }

    case "tool_result": {
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

    default:
      return state;
  }
}
