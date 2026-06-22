import { NextRequest } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { buildAttachmentPrompt } from "@/lib/build-multimodal-prompt";
import { getAssistantCacheRoot } from "@/lib/file-utils";
import { ClaudeCliAdapter } from "@/lib/ai/adapters/cli/claude-cli-adapter";
import { resolveSdkExecutable } from "@/lib/platform";
import { db } from "@/lib/db";
import { buildTowerMcpConfig } from "@/lib/ai/install-orchestrator";
import { ATTACHMENT_SUBPATH_RE, MAX_ATTACHMENTS } from "@/lib/attachment-utils";
import { readConfigValue } from "@/lib/config-reader";
import {
  classifyResultOutcome,
  shouldRetryFreshOnResume,
  isStaleResumeError,
} from "@/lib/ai/assistant-turn";

const claudeAdapter = new ClaudeCliAdapter();

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Local `YYYY-MM-DD HH:mm:ss` stamp — interleaved turns are otherwise hard to
 *  tell apart in the server log. Local time (not ISO/UTC) for readability. */
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** Timestamped server log for the assistant chat turn. */
function clog(message: string): void {
  console.error(`[${stamp()}] [assistant-chat] ${message}`);
}

/**
 * Thrown from the consume loop when a resume attempt errors before streaming
 * any content (stale CLI session). Signals the outer handler to retry as a
 * fresh session WITHOUT surfacing the transient error to the user — the SDK
 * sometimes reports the dead session as an error `result` rather than (or
 * before) throwing, so we can't rely on the thrown-error path alone.
 */
class ResumeRetryNeeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeRetryNeeded";
  }
}

/**
 * Thrown from the consume loop at `init` when the dedicated Tower MCP server
 * reported 0 tools (it didn't finish connecting before the turn started —
 * intermittent under SQLite contention when other agents hammer the same DB).
 * A tool-less turn can only narrate ("I'll create the task…") while doing
 * nothing, so we abort BEFORE any output streams and re-spawn once, which
 * almost always reconnects. Bounded to a single retry.
 */
class ToolsUnavailableRetry extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolsUnavailableRetry";
  }
}

/**
 * Thrown from the consume loop when the model itself is rejected before any
 * output streams — "selected model … may not exist or you may not have access"
 * (a gated model id, or one this account/login can't use). Signals the outer
 * handler to retry once with a known-good fallback model.
 */
class ModelUnavailableRetry extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelUnavailableRetry";
  }
}

/** Known-good model to fall back to when the configured/inherited one is
 *  unavailable. The assistant is a terse task operator, so Sonnet is the right
 *  tier and is broadly available across accounts. */
const FALLBACK_MODEL = "sonnet";

/** Whether an SDK/CLI error string indicates the requested model is unusable
 *  (unknown id, or no access for this account/login) — e.g. the gated
 *  `claude-fable-5` reaching an account without access. */
function isModelUnavailableError(detail: string): boolean {
  return /may not exist or you may not have access|selected model|model[_ ]?not[_ ]?found|unknown model|invalid model|model .*(not available|not found|does not exist)/i.test(
    detail
  );
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

  // Shared between start() and cancel() so a client disconnect (panel closed,
  // session switched, new message, navigation, transport teardown) can both
  // stop further writes AND abort the SDK. Without this, a disconnect mid-stream
  // makes send()'s enqueue throw "Invalid state: Controller is already closed"
  // and leaves the Claude CLI subprocess running headless (zombie turn).
  let streamClosed = false;
  // One AbortController per attempt — replaced before each retry so the aborted
  // attempt's CLI + MCP subprocess is killed without disarming the retry's.
  // `cancel()` (client disconnect) aborts whichever is current.
  let activeAbort = new AbortController();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(data: Record<string, unknown>) {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Client vanished between the guard and the enqueue — stop writing.
          streamClosed = true;
        }
      }

      // Hoisted so the catch can name the resolved CLI path in its error message
      // — a spawn failure here means this path couldn't be launched on the host.
      let rawClaudeCmd = "";
      let claudePath = "";
      // The model actually requested on the latest attempt — hoisted so the
      // catch can name it in a model-unavailable error message.
      let attemptedModel = "";

      try {
        const { query } = await import("@anthropic-ai/claude-agent-sdk");

        // The SDK spawns this path directly (no shell). On Windows the resolved
        // `claude` command is a `.cmd` shim, which spawn() rejects with EINVAL —
        // resolveSdkExecutable rewrites it to the underlying cli.js so the SDK
        // runs `node cli.js`. No-op on macOS/Linux and for native `.exe` installs.
        rawClaudeCmd = claudeAdapter.resolveCommand();
        claudePath = resolveSdkExecutable(rawClaudeCmd);
        // Log the resolved CLI path — a Windows `spawn EINVAL` means a `.cmd`
        // reached the SDK (it can't be rewritten to a node-runnable cli.js).
        clog(`claude exec — raw=${rawClaudeCmd} resolved=${claudePath}`);

        // Ensure .tower/ exists (runtime guard — handles deletion while server is running)
        const { ensureTowerDir } = await import("@/lib/init-tower");
        const towerDir = ensureTowerDir();

        const hasAttachments = safeAttachmentFilenames.length > 0;

        // Inject Tower MCP INLINE (not via the user-scope ~/.claude.json entry).
        // Proven by probe: the SDK *waits* for inline `mcpServers` to connect
        // before the model's turn (status "connected" at init), whereas
        // filesystem-discovered servers are left "pending" and the turn starts
        // without them → 0 tools (the flaky "some sessions have tools, some
        // don't"). buildTowerMcpConfig() is the single programmatic source of
        // truth for command/path/DB — this is not hand-maintained duplication.
        //
        // Distinct name (`<base>-assistant`) + strictMcpConfig avoids any clash
        // with the user's global tower/tower-dev and skips connecting their
        // other (slow, pending) global servers entirely — the assistant gets
        // exactly one dedicated, reliably-connected Tower instance.
        const towerMcp = buildTowerMcpConfig();
        const assistantMcpName = `${towerMcp.name}-assistant`;
        const options: Record<string, unknown> = {
          mcpServers: {
            [assistantMcpName]: {
              command: towerMcp.command,
              args: towerMcp.args,
              env: towerMcp.env,
            },
          },
          strictMcpConfig: true,
          // Disable all built-in tools — assistant is a task operator, not a coding assistant.
          // Only allow Read when attachments are present (to read the provided files).
          tools: hasAttachments ? ["Read"] : [],
          allowedTools: [`mcp__${assistantMcpName}__*`, "Read"],
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

        // The assistant is a task operator: parse intent → call one Tower MCP
        // tool → confirm in a sentence or two. It is NOT a reasoning agent, so
        // the SDK default `effort: "high"` is wrong here — on Opus-class models
        // high effort + adaptive thinking can emit a huge *thinking* trace for a
        // trivial request, and thinking tokens count toward the per-response
        // output cap. That is the real reason a turn whose final reply is only a
        // few hundred chars can still blow past 64K output tokens: the model
        // "thinks" past the ceiling before it ever writes the short answer.
        // Low effort keeps thinking minimal and replies terse; `maxTurns` bounds
        // the agent loop so a confused turn can't spin indefinitely.
        const effort = await readConfigValue<"low" | "medium" | "high">(
          "assistant.effort",
          "low"
        );
        const maxTurns = await readConfigValue<number>("assistant.maxTurns", 30);
        options.effort = effort;
        options.maxTurns = maxTurns;
        // The per-attempt abortController is attached inside makeQuery() (it
        // changes across retries). Aborting it cancels the underlying Claude CLI
        // turn — on client disconnect (see cancel()) and between retries — so no
        // CLI/MCP subprocess is left running headless.

        // Safety net: raise the CLI's per-response output ceiling too. With low
        // effort this should never be hit, but if a future config bumps effort
        // back up, 128K (Opus/Fable ceiling) gives more headroom than the 64K
        // default. `env` REPLACES process.env for the subprocess — spread first
        // so the CLI keeps PATH and friends.
        const maxOutputTokens = await readConfigValue<number>(
          "assistant.maxOutputTokens",
          128000
        );
        options.env = {
          ...process.env,
          CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxOutputTokens),
        };

        // Pin the assistant's model explicitly. Tower historically passed NO
        // model, so the CLI fell back to its own default — which on some
        // machines/accounts resolves to a gated model (e.g. claude-fable-5)
        // the login has no access to, failing the turn at the first message
        // with "selected model … may not exist or you may not have access".
        // Default to a broadly-available tier; the assistant is a terse task
        // operator, so Sonnet fits. Set assistant.model to "" to inherit the
        // CLI default, or to "opus"/"haiku"/a full model id to override.
        const configuredModel = await readConfigValue<string>(
          "assistant.model",
          "sonnet"
        );
        // Mutable: the model-unavailable fallback rewrites this to FALLBACK_MODEL
        // for the retry. Empty string → inherit the CLI default.
        let modelOverride = configuredModel.trim();

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

        // Always re-issue `/tower` so the skill (and its required output
        // formats) stays in context on every turn. Without it, follow-up
        // turns drift away from the skill's conventions — e.g. the task
        // creation confirmation format becomes inconsistent across sessions.
        const prompt = `${identityPrefix}/tower ${body.message}`;

        // Append attachment file paths so Claude can Read them (AI-01)
        const finalPrompt = hasAttachments
          ? buildAttachmentPrompt(prompt, safeAttachmentFilenames, getAssistantCacheRoot())
          : prompt;

        // Diagnostic counters — let us tell apart "the model never tried to call
        // a tool" (prompt/model issue) from "a tool was called but failed"
        // (permission/runtime issue) when users report "it never does anything".
        let toolUseCount = 0;

        // Whether the current attempt has forwarded any visible content (text or
        // a tool call) to the client. A stale-session resume errors BEFORE
        // streaming anything; if content already streamed, an error is a genuine
        // mid-turn failure that must be surfaced, not silently retried.
        let streamedContent = false;

        // Tool count reported by the SDK `init` snapshot. -1 = not seen yet.
        // 0 means the dedicated Tower MCP server didn't connect in time (shows
        // up as `mcpServers=[…:pending]`), so the model has no tools and can
        // only narrate — we use this to give an empty turn an actionable hint.
        let initToolCount = -1;

        // Build a query, optionally resuming a prior CLI session. Kept as a
        // factory so we can transparently retry WITHOUT resume if that session
        // no longer exists (server restart, cleared CLI history, stale UI id).
        const makeQuery = (withResume: boolean) => {
          const runOptions = { ...options };
          if (!withResume) delete (runOptions as Record<string, unknown>).resume;
          // Pin (or inherit) the model. Empty config → inherit the CLI default.
          if (modelOverride) {
            (runOptions as Record<string, unknown>).model = modelOverride;
            attemptedModel = modelOverride;
          } else {
            delete (runOptions as Record<string, unknown>).model;
            attemptedModel = "(CLI 默认)";
          }
          // Attach the CURRENT attempt's abortController (rotated before each
          // retry) so aborting one attempt doesn't disarm the next.
          (runOptions as Record<string, unknown>).abortController = activeAbort;
          return query({
            prompt: finalPrompt,
            options: runOptions as Parameters<typeof query>[0]["options"],
          });
        };

        // Tools-not-ready retry happens at most once per request (see
        // ToolsUnavailableRetry). Tracked across attempts in the loop below.
        let toolsRetried = false;
        // Model-unavailable fallback happens at most once per request.
        let modelRetried = false;

        // Consume a query's message stream, forwarding each chunk to the client.
        // `isResumeAttempt` guards the stale-session fallback: an error result on
        // a resume attempt (before any content streams) is suppressed and the
        // outer handler retries as a fresh session instead of flashing an error.
        const consume = async (
          q: ReturnType<typeof query>,
          { isResumeAttempt }: { isResumeAttempt: boolean }
        ) => {
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
                streamedContent = true;
                send({
                  type: "text",
                  content: text,
                  sessionId: msg.session_id,
                });
              }

              for (const tool of toolBlocks) {
                toolUseCount += 1;
                streamedContent = true;
                const t = tool as { type: string; id?: string; name?: string; input?: unknown };
                // Diagnostic: the real (完整入参) tool invocation. Pairs with the
                // earlier tool_start (调起) via the same block id. If this logs
                // but no matching tool_result/turn-done follows, the turn hung
                // while waiting on the MCP tool to return.
                clog(`tool_use — name=${t.name ?? "?"} id=${t.id ?? "?"} toolUses=${toolUseCount}`);
                send({
                  type: "tool_use",
                  content: t.name ?? "unknown",
                  toolId: t.id,
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
                usage?: { output_tokens?: number; input_tokens?: number };
              };
              // Always log the turn outcome so "it never does anything" reports
              // are diagnosable: a tool-less turn that still resolves "success"
              // points at the model/prompt; an error subtype points at the CLI.
              // output_tokens (which includes the thinking trace) tells us whether
              // a turn is ballooning — a few-hundred-char reply should be well
              // under ~2K; tens of thousands means runaway thinking or a loop.
              clog(
                `turn done — subtype=${resultMsg.subtype ?? "?"} ` +
                  `toolUses=${toolUseCount} numTurns=${resultMsg.num_turns ?? "?"} ` +
                  `outputTokens=${resultMsg.usage?.output_tokens ?? "?"} ` +
                  `firstTurn=${!body.sessionId}`
              );
              const outcome = classifyResultOutcome(resultMsg.subtype, resultMsg.is_error);
              if (
                shouldRetryFreshOnResume({ isResumeAttempt, outcome, streamedContent })
              ) {
                // Stale resume — the CLI session is gone. The SDK surfaced it as
                // an error result (generic/empty message) rather than throwing.
                // Bail WITHOUT emitting error/done so the outer handler retries
                // as a fresh session and the user never sees a transient error.
                throw new ResumeRetryNeeded(resultMsg.error ?? "resume execution error");
              }
              if (outcome === "error") {
                const errDetail = resultMsg.error ?? "";
                if (
                  !streamedContent &&
                  !modelRetried &&
                  attemptedModel !== FALLBACK_MODEL &&
                  isModelUnavailableError(errDetail)
                ) {
                  // Model rejected before any output (no access / unknown id).
                  // Bail WITHOUT emitting error/done so the outer handler retries
                  // once with a known-good fallback model instead of flashing an
                  // error for a turn the user can still get answered.
                  throw new ModelUnavailableRetry(errDetail);
                }
                send({ type: "error", content: resultMsg.error ?? "Execution error" });
              } else if (!streamedContent) {
                // Turn "succeeded" but the model emitted no text and called no
                // tool (only a tiny thinking trace). Without a bubble the user
                // sees total silence and assumes a hang. Surface a hint instead
                // — and when the tools never loaded (MCP connect timed out),
                // say so, since a retry usually connects on the next turn.
                const hint =
                  initToolCount === 0
                    ? "助手工具未能及时加载（MCP 连接超时），本轮没有执行任何操作。请再发送一次试试。"
                    : "助手本轮没有返回内容，请重试或换一种说法。";
                send({ type: "text", content: hint, sessionId: resultMsg.session_id });
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
                initToolCount = sysMsg.tools?.length ?? 0;
                clog(
                  `session init — mcpServers=[${servers}] toolCount=${initToolCount}`
                );
                // No tools = the Tower MCP didn't connect in time. Abort now
                // (before the model narrates a no-op turn) and re-spawn once.
                if (initToolCount === 0 && !toolsRetried) {
                  throw new ToolsUnavailableRetry(
                    `MCP not connected at init (servers=[${servers}])`
                  );
                }
              }
              if (sysMsg.subtype === "tool_result") {
                clog(`tool_result(system) — name=${sysMsg.tool_name ?? "?"}`);
                send({
                  type: "tool_result",
                  content: sysMsg.tool_name ?? "tool",
                  toolOutput: sysMsg.content ?? "",
                });
              }
              break;
            }

            // Tool results are fed back to the model as a user message whose
            // content holds tool_result blocks. Logging them lets us tell apart
            // "tool was called but never returned" (hang inside the MCP/SDK
            // layer — no log here) from "result returned but the model didn't
            // continue" (log here, but no following turn-done).
            case "user": {
              const userMsg = msg as {
                message?: { content?: Array<{ type?: string; tool_use_id?: string }> };
              };
              const results = (userMsg.message?.content ?? []).filter(
                (b) => b?.type === "tool_result"
              );
              if (results.length > 0) {
                clog(
                  `tool_result(user) — count=${results.length} ` +
                    `ids=${results.map((r) => r.tool_use_id ?? "?").join(",")}`
                );
              }
              break;
            }

            case "stream_event": {
              // SDKPartialAssistantMessage — per official docs:
              // msg.event is a RawMessageStreamEvent from the Claude API
              // msg.event.type === "content_block_delta" && msg.event.delta.type === "text_delta"
              const streamEvent = (msg as { event: { type: string; delta?: { type: string; text?: string }; content_block?: { type: string; id?: string; name?: string } }; session_id: string });
              const evt = streamEvent.event;

              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
                streamedContent = true;
                send({ type: "text_delta", content: evt.delta.text, sessionId: streamEvent.session_id });
              } else if (evt.type === "content_block_start" && evt.content_block?.type === "tool_use") {
                // 调起 (placeholder). Carries the same block id as the later
                // tool_use so the client merges them into ONE card instead of
                // rendering two identical entries.
                send({ type: "tool_start", content: evt.content_block.name ?? "tool", toolId: evt.content_block.id, sessionId: streamEvent.session_id });
              }
              break;
            }

            default:
              // Ignore other message types (status, auth, hooks, etc.)
              break;
          }
        }
        };

        // Run; if resuming a now-missing session, fall back to a fresh one so a
        // restarted server / cleared CLI history doesn't dead-end the user. A
        // dead session surfaces with no streamed output first — either thrown
        // ("no conversation found …") or as an error `result` (caught inside
        // consume and re-thrown as ResumeRetryNeeded). Both retry transparently,
        // so neither the transient error nor any duplicate output reaches the user.
        // Attempt loop with two transparent, each-at-most-once retries:
        //  - tools not ready: init reported 0 tools (MCP didn't connect in time
        //    under DB contention). Re-spawn, KEEPING the resume flag — we aborted
        //    at init before any output, so nothing duplicates.
        //  - stale resume: the CLI session is gone. Re-run as a FRESH session so
        //    a restarted server / cleared CLI history doesn't dead-end the user.
        // Both surface with no streamed output first; neither the transient error
        // nor duplicate output reaches the user.
        let attemptResume = Boolean(body.sessionId);
        let usedResumeFallback = false;
        for (;;) {
          try {
            toolUseCount = 0;
            streamedContent = false;
            initToolCount = -1;
            await consume(makeQuery(attemptResume), { isResumeAttempt: attemptResume });
            break;
          } catch (runErr: unknown) {
            // Kill the aborted attempt's CLI + MCP before re-running, and arm a
            // fresh controller for the next attempt.
            activeAbort.abort();
            activeAbort = new AbortController();

            if (runErr instanceof ToolsUnavailableRetry && !toolsRetried) {
              toolsRetried = true;
              clog(`${runErr.message}; re-spawning once to reconnect MCP`);
              continue;
            }
            const runDetail = runErr instanceof Error ? runErr.message : String(runErr);
            // Model rejected (no access / unknown id) — retry once with a
            // known-good fallback model so a gated CLI default (e.g.
            // claude-fable-5) or a mis-set assistant.model doesn't dead-end the
            // turn. The model error surfaces with no streamed output first
            // (either thrown as ModelUnavailableRetry or matched here), so the
            // re-run doesn't duplicate anything.
            if (
              !modelRetried &&
              attemptedModel !== FALLBACK_MODEL &&
              (runErr instanceof ModelUnavailableRetry ||
                isModelUnavailableError(runDetail))
            ) {
              modelRetried = true;
              modelOverride = FALLBACK_MODEL;
              clog(
                `model ${attemptedModel} unavailable (${runDetail}); retrying with fallback model ${FALLBACK_MODEL}`
              );
              continue;
            }
            const staleResume =
              runErr instanceof ResumeRetryNeeded ||
              (attemptResume && isStaleResumeError(runDetail));
            if (staleResume && !usedResumeFallback) {
              usedResumeFallback = true;
              attemptResume = false;
              clog(
                `resume failed for sessionId=${body.sessionId} (${runDetail}); retrying as a fresh session`
              );
              continue;
            }
            throw runErr;
          }
        }
      } catch (err: unknown) {
        // Client disconnected and we aborted the SDK ourselves — benign. The
        // sink is gone so there's nothing to surface; don't log it as an error
        // (it previously showed up as the scary "Controller is already closed").
        if (streamClosed || activeAbort.signal.aborted) {
          clog("client disconnected — turn aborted before completion");
          return;
        }
        // Always log the full error server-side — this is a localhost-only
        // internal route, so the logs are private. Suppressing in production
        // (the standalone build) left Windows users with no way to diagnose
        // failures beyond the generic client message.
        const detail = err instanceof Error ? err.message : String(err);
        clog(
          `ERROR: ${detail}${err instanceof Error && err.stack ? `\n${err.stack}` : ""}`
        );
        // Surface the real reason to the (localhost) client so it shows up in
        // the chat bubble and can be reported directly. Give the output-cap
        // error an actionable message — it means the model wanted to emit more
        // than the current model's per-response limit (64K on Sonnet/Haiku,
        // 128K on Opus); the fix is a shorter ask or a higher-output model.
        // A spawn failure (ENOENT/EINVAL/spawn …) means the Claude CLI path we
        // resolved couldn't be launched on this machine — almost always Claude
        // Code isn't installed / not on PATH, or its shim layout couldn't be
        // rewritten to a node-runnable cli.js. Name the resolved path so the
        // user can act without digging through server logs.
        const isSpawnFailure = /\bspawn\b|ENOENT|EINVAL/i.test(detail);
        const friendly = /output token maximum|max_output_tokens/i.test(detail)
          ? "回复内容超出了模型单次输出上限。请把问题拆小一些，或在设置里把 assistant.maxOutputTokens 调整为所用模型支持的上限（Sonnet/Haiku 最高 64K，Opus 最高 128K）。"
          : isModelUnavailableError(detail)
          ? `助手所用模型不可用（${attemptedModel || "?"}）：该模型可能不存在，或当前账号 / Claude 登录无权访问它。助手用哪个模型由配置项 assistant.model 决定（默认 sonnet）；留空则继承 Claude CLI 的默认模型（受 ANTHROPIC_MODEL 环境变量或 ~/.claude 设置里的 model 影响）。请把 assistant.model 设为账号有权限的模型（如 sonnet / opus / haiku），或修正 Claude CLI 的默认模型。原始错误：${detail}`
          : isSpawnFailure
          ? `无法启动 Claude CLI（raw=${rawClaudeCmd || "?"} resolved=${claudePath || "?"}）。请确认本机已安装 Claude Code 且能在命令行执行 \`claude --version\`；若已安装但仍失败，可设置环境变量 CLAUDE_CODE_PATH 指向 claude 的 cli.js。原始错误：${detail}`
          : `Assistant encountered an error: ${detail}`;
        send({ type: "error", content: friendly });
      } finally {
        send({ type: "done" });
        streamClosed = true;
        // May already be closed by cancel() (client disconnect) — don't throw.
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      // The client went away (panel closed, session switched, new message,
      // navigation, or transport teardown). Stop writing and abort the SDK so
      // the Claude CLI subprocess doesn't keep running headless.
      streamClosed = true;
      activeAbort.abort();
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
