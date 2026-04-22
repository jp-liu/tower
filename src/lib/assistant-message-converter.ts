/**
 * Convert Claude Agent SDK SessionMessage[] → ChatMessage[] for the assistant UI.
 */

import type { ChatMessage } from "@/hooks/use-assistant-chat";

/** Minimal shape of what the SDK returns from getSessionMessages */
export interface SDKSessionMessage {
  type: "user" | "assistant" | "system";
  uuid: string;
  session_id: string;
  message: unknown;
  parent_tool_use_id: null;
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  thinking?: string;
}

interface UserContentBlock {
  type: string;
  source?: { type?: string; media_type?: string; data?: string };
  text?: string;
}

/**
 * Extract imageFilenames from a user message's content field.
 * Currently returns undefined for Phase 42 (images tracked client-side).
 * Phase 43 will populate this from SDK image blocks when multimodal is wired.
 */
function extractImageFilenames(content: unknown): string[] | undefined {
  // If content is an array of multimodal blocks, look for image blocks (Phase 43+)
  if (Array.isArray(content)) {
    const imageBlocks = (content as UserContentBlock[]).filter(
      (b) => b.type === "image" && b.source?.data
    );
    if (imageBlocks.length > 0) {
      // Phase 43 will map these to server filenames; for now return undefined
      return undefined;
    }
  }
  return undefined;
}

interface SystemPayload {
  subtype?: string;
  tool_name?: string;
  content?: string;
}

function nextId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function convertSessionMessages(sdkMessages: SDKSessionMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const msg of sdkMessages) {
    switch (msg.type) {
      case "user": {
        const payload = msg.message as { content?: unknown };
        let text = typeof payload?.content === "string" ? payload.content : "";
        // Strip "/tower " prefix injected by chat route
        if (text.startsWith("/tower ")) text = text.slice(7);
        // Strip skill XML wrapping: <command-message>tower</command-message><command-name>/tower</command-name><command-args>actual text</command-args>
        const argsMatch = text.match(/<command-args>([\s\S]*?)<\/command-args>/);
        if (argsMatch) text = argsMatch[1].trim();
        const imageFilenames = extractImageFilenames(payload?.content);
        if (text) {
          result.push({ id: nextId(), role: "user", content: text, imageFilenames });
        }
        break;
      }

      case "assistant": {
        const payload = msg.message as { content?: ContentBlock[] };
        const blocks = Array.isArray(payload?.content) ? payload.content : [];

        // Collect text blocks
        const textParts = blocks
          .filter((b) => b.type === "text" && b.text)
          .map((b) => b.text!);

        if (textParts.length > 0) {
          result.push({
            id: nextId(),
            role: "assistant",
            content: textParts.join(""),
          });
        }

        // Collect tool_use blocks as separate messages
        for (const block of blocks) {
          if (block.type === "tool_use" && block.name) {
            result.push({
              id: nextId(),
              role: "tool",
              content: JSON.stringify(block.input ?? {}, null, 2),
              toolName: block.name,
            });
          }
        }
        break;
      }

      case "system": {
        const payload = msg.message as SystemPayload | undefined;
        if (payload?.subtype === "tool_result" && payload.content) {
          result.push({
            id: nextId(),
            role: "tool",
            content: payload.content,
            toolName: `${payload.tool_name ?? "tool"} (result)`,
          });
        }
        // Skip other system messages
        break;
      }
    }
  }

  return result;
}
