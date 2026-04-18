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
    "You are Tower Assistant, an AI operator for the Tower task management platform. You help users create, organize, query, and track tasks and projects using Tower MCP tools. You do NOT write or edit code — you are an operator, not a developer. Always respond in the same language the user uses."
  );

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        // Dynamic import — SDK is heavy, only load when needed
        const { query } = await import("@anthropic-ai/claude-agent-sdk");

        const options: Record<string, unknown> = {
          systemPrompt,
          allowedTools: ["mcp__tower__*"],
          permissionMode: "bypassPermissions" as const,
          cwd: process.cwd(),
          // Use globally installed claude CLI (SDK bundles its own but optional deps may be skipped)
          pathToClaudeCodeExecutable: findClaudeBinary(),
        };

        // Resume previous session if sessionId provided
        if (body.sessionId) {
          (options as Record<string, unknown>).resume = body.sessionId;
        }

        const q = query({
          prompt: body.message,
          options: options as Parameters<typeof query>[0]["options"],
        });

        for await (const msg of q) {
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

            default:
              // Ignore other message types (status, auth, hooks, etc.)
              break;
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", content: message });
      } finally {
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
