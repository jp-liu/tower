import { NextRequest } from "next/server";
import { execFileSync } from "child_process";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { readConfigValue } from "@/lib/config-reader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Resolve the claude CLI binary path — env var > `which claude` */
function findClaudeBinary(): string {
  if (process.env.CLAUDE_CODE_PATH) return process.env.CLAUDE_CODE_PATH;
  try {
    return execFileSync("which", ["claude"], { encoding: "utf-8", timeout: 3000 }).trim();
  } catch {
    return "claude"; // fallback — let SDK try PATH
  }
}

/**
 * POST /api/internal/assistant/chat
 *
 * Accepts { message: string, sessionId?: string } and streams Claude Agent SDK
 * responses as Server-Sent Events (SSE). Each event is a JSON object with:
 *   - type: "text" | "thinking" | "tool_use" | "tool_result" | "error" | "done"
 *   - content: string (text content or tool info)
 *   - sessionId?: string (returned on first assistant message for resume support)
 *
 * The SDK spawns a Claude Code CLI subprocess per query() call.
 * For multi-turn, pass the sessionId from a previous response.
 */
export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  let body: { message: string; sessionId?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.message?.trim()) {
    return new Response(JSON.stringify({ error: "Message is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const systemPrompt = await readConfigValue<string>(
    "assistant.systemPrompt",
    "You are Tower Assistant — the built-in AI operator for the Tower task management platform. Your ONLY capabilities are Tower MCP tools. You CANNOT read files, edit code, run commands, or do anything outside Tower task management. Always respond in the same language the user uses."
  );

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        console.error("[assistant-chat] Starting SDK query...");
        const { query } = await import("@anthropic-ai/claude-agent-sdk");
        console.error("[assistant-chat] SDK imported, building options...");

        const claudePath = findClaudeBinary();
        console.error("[assistant-chat] Claude binary:", claudePath);

        // Use home dir as cwd to avoid loading CLAUDE.md from project directory.
        // CLAUDE.md gives the CLI full coding-assistant identity which overrides our systemPrompt.
        // Tower MCP is configured globally, not per-cwd, so tools still work.
        const homedir = require("os").homedir() as string;

        const options: Record<string, unknown> = {
          systemPrompt,
          // No built-in tools — assistant is an operator, not a developer
          tools: [],
          // Auto-approve Tower MCP tools (the only tools available)
          allowedTools: ["mcp__tower__*"],
          // Streaming — receive text_delta chunks as they arrive
          includePartialMessages: true,
          // Home dir — no CLAUDE.md here
          cwd: homedir,
          pathToClaudeCodeExecutable: claudePath,
        };

        // Resume previous session if sessionId provided
        if (body.sessionId) {
          (options as Record<string, unknown>).resume = body.sessionId;
        }

        const q = query({
          prompt: body.message,
          options: options as Parameters<typeof query>[0]["options"],
        });

        console.error("[assistant-chat] Query created, iterating messages...");

        for await (const msg of q) {
          console.error("[assistant-chat] Message received:", msg.type, "subtype" in msg ? (msg as { subtype?: string }).subtype : "");
          switch (msg.type) {
            case "assistant": {
              // Extract text content from message blocks
              const textBlocks = msg.message.content.filter(
                (b: { type: string }) => b.type === "text"
              );
              const text = textBlocks
                .map((b: { type: string; text?: string }) => b.text ?? "")
                .join("");

              // Extract tool_use blocks
              const toolBlocks = msg.message.content.filter(
                (b: { type: string }) => b.type === "tool_use"
              );

              if (text) {
                send({
                  type: "text",
                  content: text,
                  sessionId: msg.session_id,
                });
              }

              for (const tool of toolBlocks) {
                const t = tool as { type: string; name?: string; input?: unknown };
                send({
                  type: "tool_use",
                  content: t.name ?? "unknown",
                  toolInput: t.input,
                  sessionId: msg.session_id,
                });
              }
              break;
            }

            case "result": {
              const resultMsg = msg as { subtype?: string; error?: string; session_id?: string };
              if (resultMsg.subtype?.includes("error")) {
                send({ type: "error", content: resultMsg.error ?? "Execution error" });
              }
              send({ type: "done", sessionId: resultMsg.session_id });
              break;
            }

            // System messages — tool results, status, etc.
            case "system": {
              const sysMsg = msg as { subtype?: string; tool_name?: string; content?: string };
              if (sysMsg.subtype === "tool_result") {
                send({
                  type: "tool_result",
                  content: sysMsg.tool_name ?? "tool",
                  toolOutput: sysMsg.content ?? "",
                });
              }
              break;
            }

            case "stream_event": {
              // SDKPartialAssistantMessage — per official docs:
              // msg.event is a RawMessageStreamEvent from the Claude API
              // msg.event.type === "content_block_delta" && msg.event.delta.type === "text_delta"
              const streamEvent = (msg as { event: { type: string; delta?: { type: string; text?: string }; content_block?: { type: string; name?: string } }; session_id: string });
              const evt = streamEvent.event;

              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
                send({ type: "text_delta", content: evt.delta.text, sessionId: streamEvent.session_id });
              } else if (evt.type === "content_block_start" && evt.content_block?.type === "tool_use") {
                send({ type: "tool_start", content: evt.content_block.name ?? "tool", sessionId: streamEvent.session_id });
              }
              break;
            }

            default:
              // Ignore other message types (status, auth, hooks, etc.)
              break;
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[assistant-chat] ERROR:", message);
        if (err instanceof Error && err.stack) console.error(err.stack);
        send({ type: "error", content: message });
      } finally {
        console.error("[assistant-chat] Stream complete");
        send({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
