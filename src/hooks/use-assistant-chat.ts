"use client";

import { useEffect, useRef, useState } from "react";
import { getConfigValue } from "@/actions/config-actions";
import { ASSISTANT_SESSION_KEY } from "@/lib/assistant-constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageRole = "user" | "assistant" | "thinking" | "tool";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  toolName?: string;
  isStreaming?: boolean;
}

export interface UseAssistantChatReturn {
  messages: ChatMessage[];
  isThinking: boolean;
  sendMessage: (text: string) => void;
  wsStatus: "connecting" | "connected" | "disconnected";
}

// ---------------------------------------------------------------------------
// ANSI stripping
// ---------------------------------------------------------------------------

const ANSI_REGEX =
  /\x1B(?:[@-Z\\_]|\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\))/g;

/**
 * Strip ANSI/VT escape sequences from a string.
 * Handles: CSI (color, cursor movement), OSC (title), two-character ESC forms.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

// ---------------------------------------------------------------------------
// Spinner/thinking pattern matchers
// ---------------------------------------------------------------------------

// Braille spinner characters used by Claude CLI
const SPINNER_CHARS = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
// Hourglass / thinking indicators
const THINKING_CHARS = /[⏳⌛]/;
// Box-drawing characters that Claude CLI uses as message boundaries
const BOX_TOP = /^[╭┌]/;
const BOX_BOT = /^[╰└]/;

// ---------------------------------------------------------------------------
// Message ID generator
// ---------------------------------------------------------------------------

function nextId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Parser result type (used by parseLines)
// ---------------------------------------------------------------------------

interface ParseResult {
  messages: ChatMessage[];
  buffer: string;
}

/**
 * Pure incremental state-machine parser.
 * Exported for unit testing — production code calls it inside the WS message handler.
 *
 * @param existingMessages  Previously accumulated messages (mutated immutably via spread)
 * @param lineBuffer        Partial line buffer from previous chunk
 * @param newLines          Complete lines to process (already split, ANSI stripped)
 * @returns                 Updated messages array + new buffer (always "" here, caller manages)
 */
export function parseLines(
  existingMessages: ChatMessage[],
  lineBuffer: string,
  newLines: string[]
): ParseResult {
  // Work on a mutable local copy
  const msgs: ChatMessage[] = existingMessages.map((m) => ({ ...m }));

  // Helper: get or create current trailing assistant message
  function lastAssistant(): ChatMessage | undefined {
    if (msgs.length > 0 && msgs[msgs.length - 1].role === "assistant") {
      return msgs[msgs.length - 1];
    }
    return undefined;
  }

  function appendAssistant(line: string): void {
    const last = lastAssistant();
    if (last) {
      msgs[msgs.length - 1] = { ...last, content: last.content ? last.content + "\n" + line : line };
    } else {
      msgs.push({ id: nextId(), role: "assistant", content: line });
    }
  }

  for (const rawLine of newLines) {
    const line = rawLine.trim();
    if (line === "") continue;

    // --- Box-drawing top boundary: finalize current block, start fresh ---
    if (BOX_TOP.test(line)) {
      // Just mark a boundary — subsequent lines start a new assistant block
      // Push a sentinel so next assistant line doesn't merge with previous
      // We don't actually create a message for the box char itself.
      continue;
    }

    // --- Box-drawing bottom boundary: end of current block ---
    if (BOX_BOT.test(line)) {
      continue;
    }

    // --- User prompt ---
    if (line.startsWith(">") || line.startsWith("❯")) {
      const content = line.replace(/^[>❯]\s*/, "").trim();
      if (content) {
        msgs.push({ id: nextId(), role: "user", content });
      }
      continue;
    }

    // --- Thinking/spinner ---
    if (SPINNER_CHARS.test(line) || THINKING_CHARS.test(line)) {
      // Update or create a streaming thinking message
      const last = msgs[msgs.length - 1];
      if (last && last.role === "thinking" && last.isStreaming) {
        msgs[msgs.length - 1] = { ...last, content: line };
      } else {
        msgs.push({ id: nextId(), role: "thinking", content: line, isStreaming: true });
      }
      continue;
    }

    // --- Tool call ---
    if (line.startsWith("Tool:")) {
      const toolName = line.replace(/^Tool:\s*/, "").split(/\s/)[0];
      msgs.push({ id: nextId(), role: "tool", content: line, toolName });
      continue;
    }

    // --- Default: accumulate as assistant content ---
    appendAssistant(line);
  }

  return { messages: msgs, buffer: lineBuffer };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAssistantChat(opts: {
  enabled: boolean;
}): UseAssistantChatReturn {
  const { enabled } = opts;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "disconnected">(
    "disconnected"
  );

  // Refs for stable access inside WS callbacks
  const wsRef = useRef<WebSocket | null>(null);
  const lineBufferRef = useRef<string>("");
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  useEffect(() => {
    if (!enabled) {
      // Close any existing connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsStatus("disconnected");
      return;
    }

    let cancelled = false;
    let socket: WebSocket | null = null;

    getConfigValue<number>("terminal.wsPort", 3001).then((wsPort) => {
      if (cancelled) return;

      const url = `ws://localhost:${wsPort}/terminal?taskId=${encodeURIComponent(ASSISTANT_SESSION_KEY)}`;
      socket = new WebSocket(url);
      wsRef.current = socket;
      setWsStatus("connecting");

      socket.addEventListener("open", () => {
        if (!cancelled) setWsStatus("connected");
      });

      socket.addEventListener("close", () => {
        if (!cancelled) setWsStatus("disconnected");
      });

      socket.addEventListener("error", () => {
        if (!cancelled) setWsStatus("disconnected");
      });

      socket.addEventListener("message", (event) => {
        if (cancelled) return;
        const raw: string = typeof event.data === "string" ? event.data : "";
        if (!raw) return;

        // Append to line buffer, split on newlines
        const combined = lineBufferRef.current + raw;
        const parts = combined.split("\n");
        // Last element is incomplete (or empty if ends with \n)
        lineBufferRef.current = parts.pop() ?? "";

        // Strip ANSI from each complete line
        const cleanLines = parts.map((l) => stripAnsi(l));

        setMessages((prev) => {
          const result = parseLines(prev, "", cleanLines);
          return result.messages;
        });
      });
    });

    return () => {
      cancelled = true;
      if (socket) {
        socket.close();
        socket = null;
      }
      wsRef.current = null;
      lineBufferRef.current = "";
      setWsStatus("disconnected");
    };
  }, [enabled]);

  const sendMessage = (text: string): void => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(text + "\n");
    }
  };

  const lastMsg = messages[messages.length - 1];
  const isThinking = lastMsg?.role === "thinking" && lastMsg.isStreaming === true;

  return { messages, isThinking, sendMessage, wsStatus };
}
