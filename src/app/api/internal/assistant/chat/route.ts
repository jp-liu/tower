import { NextRequest } from "next/server";
import { execFileSync } from "child_process";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { buildMultimodalPrompt } from "@/lib/build-multimodal-prompt";
import { getAssistantCacheRoot } from "@/lib/file-utils";

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

  let body: { message: string; sessionId?: string; imageFilenames?: string[] };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate imageFilenames: must be array of strings matching UUID filename format
  const IMAGE_FILENAME_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp)$/i;
  const safeImageFilenames = Array.isArray(body.imageFilenames)
    ? body.imageFilenames.filter(
        (f): f is string => typeof f === "string" && IMAGE_FILENAME_RE.test(f)
      )
    : [];

  if (!body.message?.trim() && safeImageFilenames.length === 0) {
    return new Response(JSON.stringify({ error: "Message or images required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // System prompt is defined in .tower/CLAUDE.md — CLI auto-discovers it from cwd
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        const { query } = await import("@anthropic-ai/claude-agent-sdk");

        const claudePath = findClaudeBinary();

        // Ensure .tower/ exists (runtime guard — handles deletion while server is running)
        const { ensureTowerDir } = await import("@/lib/init-tower");
        const towerDir = ensureTowerDir();

        const hasImages = safeImageFilenames.length > 0;

        const options: Record<string, unknown> = {
          // No built-in tools for text-only — add Read tool when images are attached (AI-02)
          tools: hasImages ? ["Read"] : [],
          // Auto-approve Tower MCP tools; also auto-approve Read when images attached
          allowedTools: hasImages
            ? ["mcp__tower__*", "Read"]
            : ["mcp__tower__*"],
          // Streaming — receive text_delta chunks as they arrive
          includePartialMessages: true,
          // .tower/ directory has its own CLAUDE.md with assistant persona
          cwd: towerDir,
          pathToClaudeCodeExecutable: claudePath,
        };

        // Resume previous session if sessionId provided
        if (body.sessionId) {
          (options as Record<string, unknown>).resume = body.sessionId;
        }

        // Prepend /tower to every message to load the Tower skill into context.
        const prompt = `/tower ${body.message}`;

        // Build multimodal prompt with image paths if images attached (AI-01)
        const finalPrompt = hasImages
          ? buildMultimodalPrompt(prompt, safeImageFilenames, getAssistantCacheRoot())
          : prompt;

        const q = query({
          prompt: finalPrompt,
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
        if (process.env.NODE_ENV !== "production") {
          const detail = err instanceof Error ? err.message : String(err);
          console.error("[assistant-chat] ERROR:", detail);
        }
        send({ type: "error", content: "Assistant encountered an error. Please try again." });
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
