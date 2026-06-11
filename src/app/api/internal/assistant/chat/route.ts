import { NextRequest } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { buildAttachmentPrompt } from "@/lib/build-multimodal-prompt";
import { getAssistantCacheRoot } from "@/lib/file-utils";
import { ClaudeCliAdapter } from "@/lib/ai/adapters/cli/claude-cli-adapter";
import { resolveSdkExecutable } from "@/lib/platform";
import { db } from "@/lib/db";
import { getTowerMcpName } from "@/lib/ai/install-orchestrator";
import { ATTACHMENT_SUBPATH_RE, MAX_ATTACHMENTS } from "@/lib/attachment-utils";

const claudeAdapter = new ClaudeCliAdapter();

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  let body: { message: string; sessionId?: string; attachmentFilenames?: string[] };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate attachmentFilenames against the central allowlist regex
  const safeAttachmentFilenames = Array.isArray(body.attachmentFilenames)
    ? body.attachmentFilenames
        .filter(
          (f): f is string => typeof f === "string" && ATTACHMENT_SUBPATH_RE.test(f)
        )
        .slice(0, MAX_ATTACHMENTS)
    : [];

  if (!body.message?.trim() && safeAttachmentFilenames.length === 0) {
    return new Response(JSON.stringify({ error: "Message or attachments required" }), {
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

        // The SDK spawns this path directly (no shell). On Windows the resolved
        // `claude` command is a `.cmd` shim, which spawn() rejects with EINVAL —
        // resolveSdkExecutable rewrites it to the underlying cli.js so the SDK
        // runs `node cli.js`. No-op on macOS/Linux and for native `.exe` installs.
        const claudePath = resolveSdkExecutable(claudeAdapter.resolveCommand());

        // Ensure .tower/ exists (runtime guard — handles deletion while server is running)
        const { ensureTowerDir } = await import("@/lib/init-tower");
        const towerDir = ensureTowerDir();

        const hasAttachments = safeAttachmentFilenames.length > 0;

        // Tower MCP is maintained in ONE place: the user-scope entry that
        // instrumentation.ts installs via `claude mcp add` on boot (the same
        // "tower" you see in `claude mcp list`). We deliberately do NOT inline a
        // second copy here — per the Claude Agent SDK docs, user-scope MCP from
        // ~/.claude.json loads regardless of cwd, so the embedded assistant
        // already sees it. (An earlier inline copy named "tower" collided with
        // the global one and made tool loading flaky; the fix is to not inline
        // at all, not to add a third config surface.)
        const towerMcpName = getTowerMcpName();
        const options: Record<string, unknown> = {
          // Disable all built-in tools — assistant is a task operator, not a coding assistant.
          // Only allow Read when attachments are present (to read the provided files).
          tools: hasAttachments ? ["Read"] : [],
          allowedTools: [`mcp__${towerMcpName}__*`, "Read"],
          // Execute tool calls without prompting. The assistant runs headless
          // over a localhost-only SSE route with no interactive permission UI
          // and no `canUseTool` callback, so in the default permission mode the
          // CLI's auto-mode classifier denies write MCP tools (create/delete
          // task, etc.) and resolves the turn to "No response requested." —
          // the model describes the work but never invokes the tools (#10).
          // The available toolset is already strictly limited to Tower MCP
          // tools (+ Read for attachments), so bypassing prompts is safe here.
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
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

        // Prepend username identity context on first turn only (no sessionId)
        let identityPrefix = "";
        if (!body.sessionId) {
          const usernameRow = await db.systemConfig.findUnique({ where: { key: "onboarding.username" } });
          try {
            const parsed = usernameRow ? JSON.parse(usernameRow.value) : null;
            if (typeof parsed === "string" && parsed.length > 0) {
              identityPrefix = `[Context: The user's name is ${parsed}.]\n\n`;
            }
          } catch { /* ignore parse errors */ }
        }

        // Load the Tower skill via `/tower`, but ONLY on the first turn (no
        // sessionId). On resumed turns the skill is already in context, and
        // re-issuing the `/tower` slash command every message made the model
        // treat each follow-up as a fresh skill-load — it would reply with a
        // short acknowledgement ("立即创建") and end the turn without ever
        // emitting the tool call. Plain follow-up text keeps the agent loop
        // going so it actually invokes the MCP tool.
        const prompt = body.sessionId
          ? `${identityPrefix}${body.message}`
          : `${identityPrefix}/tower ${body.message}`;

        // Append attachment file paths so Claude can Read them (AI-01)
        const finalPrompt = hasAttachments
          ? buildAttachmentPrompt(prompt, safeAttachmentFilenames, getAssistantCacheRoot())
          : prompt;

        const q = query({
          prompt: finalPrompt,
          options: options as Parameters<typeof query>[0]["options"],
        });

        // Diagnostic counters — let us tell apart "the model never tried to call
        // a tool" (prompt/model issue) from "a tool was called but failed"
        // (permission/runtime issue) when users report "it never does anything".
        let toolUseCount = 0;

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
                toolUseCount += 1;
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
              const resultMsg = msg as {
                subtype?: string;
                error?: string;
                session_id?: string;
                num_turns?: number;
                is_error?: boolean;
              };
              // Always log the turn outcome so "it never does anything" reports
              // are diagnosable: a tool-less turn that still resolves "success"
              // points at the model/prompt; an error subtype points at the CLI.
              console.error(
                `[assistant-chat] turn done — subtype=${resultMsg.subtype ?? "?"} ` +
                  `toolUses=${toolUseCount} numTurns=${resultMsg.num_turns ?? "?"} ` +
                  `firstTurn=${!body.sessionId}`
              );
              if (resultMsg.subtype?.includes("error") || resultMsg.is_error) {
                send({ type: "error", content: resultMsg.error ?? "Execution error" });
              }
              send({ type: "done", sessionId: resultMsg.session_id });
              break;
            }

            // System messages — tool results, status, etc.
            case "system": {
              const sysMsg = msg as {
                subtype?: string;
                tool_name?: string;
                content?: string;
                tools?: string[];
                mcp_servers?: { name: string; status: string }[];
              };
              // The init message reports which MCP servers connected and which
              // tools are available. If Tower MCP failed to connect, the model
              // has no create_task tool and can only narrate — log it so that
              // failure mode is obvious instead of silent.
              if (sysMsg.subtype === "init") {
                const servers = (sysMsg.mcp_servers ?? [])
                  .map((s) => `${s.name}:${s.status}`)
                  .join(",");
                console.error(
                  `[assistant-chat] session init — mcpServers=[${servers}] ` +
                    `toolCount=${sysMsg.tools?.length ?? 0}`
                );
              }
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
        // Always log the full error server-side — this is a localhost-only
        // internal route, so the logs are private. Suppressing in production
        // (the standalone build) left Windows users with no way to diagnose
        // failures beyond the generic client message.
        const detail = err instanceof Error ? err.message : String(err);
        console.error(
          "[assistant-chat] ERROR:",
          detail,
          err instanceof Error && err.stack ? `\n${err.stack}` : ""
        );
        // Surface the real reason to the (localhost) client so it shows up in
        // the chat bubble and can be reported directly.
        send({
          type: "error",
          content: `Assistant encountered an error: ${detail}`,
        });
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
