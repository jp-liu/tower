import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { ATTACHMENT_SUBPATH_RE, MAX_ATTACHMENTS } from "@/lib/attachment-utils";
import { ensureTowerDir } from "@/lib/init-tower";
import { readConfigValue } from "@/lib/config-reader";
import { buildTowerMcpConfig } from "@/lib/ai/install-orchestrator";
import { streamAssistantTurn } from "@/lib/ai/assistant-stream-executor";
import { recordCapabilityAttemptService } from "@/lib/ai/capability-config-service";
import { assistantLegacyAdapter } from "@/lib/ai/assistant-legacy-adapter";
import { buildAssistantCliPrompt, buildAssistantSystemPrompt } from "@/lib/ai/assistant-prompt";
import { normalizeAssistantHistoryTurns } from "@/lib/ai/assistant-history";
import {
  AssistantSessionError,
  MAX_ASSISTANT_MESSAGE_BYTES,
  MAX_ASSISTANT_PARTS,
  MAX_ASSISTANT_STREAM_BYTES,
  assistantMessagesToApi,
  assistantSessionIdSchema,
  assistantSessionService,
  attachmentParts,
  normalizeAssistantParts,
  towerSessionIdSchema,
  trimAssistantHistory,
  type AssistantBinding,
  type AssistantPart,
} from "@/lib/ai/assistant-session-service";
import { redactSecretValue } from "@/lib/secret-redaction";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  message: z.string().max(256 * 1024).default(""),
  sessionId: assistantSessionIdSchema.optional(),
  clientTurnId: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/).optional(),
  attachmentFilenames: z.array(z.string().regex(ATTACHMENT_SUBPATH_RE)).max(MAX_ATTACHMENTS).default([]),
  workspaceId: z.string().min(1).max(128).optional(),
  workspaceName: z.string().max(256).optional(),
  projectId: z.string().min(1).max(128).optional(),
  projectName: z.string().max(256).optional(),
  versionId: z.string().min(1).max(128).optional(),
  versionName: z.string().max(256).optional(),
}).strict();

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function binding(body: z.infer<typeof bodySchema>): AssistantBinding {
  return {
    ...(body.workspaceId ? { workspaceId: body.workspaceId } : {}),
    ...(body.projectId ? { projectId: body.projectId } : {}),
    ...(body.versionId ? { versionId: body.versionId } : {}),
  };
}

function currentAttachmentContext(parts: AssistantPart[]): string | undefined {
  const attachments = parts.filter((part): part is Extract<AssistantPart, { type: "attachment" }> =>
    part.type === "attachment"
  );
  if (!attachments.length) return undefined;
  return [
    "Current-message attachments available to read_attachment (use the exact attachment identifier):",
    ...attachments.map((part) => `- ${JSON.stringify(part.attachment)} (${part.mimeType}, ${part.size} bytes)`),
  ].join("\n");
}

function safeToolOutput(value: unknown): string {
  const safe = redactSecretValue(value);
  return typeof safe === "string" ? safe : JSON.stringify(safe, null, 2);
}

const MAX_PERSISTED_ERROR_CHARS = 1024;

function normalizeStreamingParts(parts: AssistantPart[]): AssistantPart[] {
  const safe = normalizeAssistantParts(parts);
  const bytes = Buffer.byteLength(JSON.stringify(safe));
  if (safe.length >= MAX_ASSISTANT_PARTS || bytes > MAX_ASSISTANT_STREAM_BYTES) {
    throw new AssistantSessionError("message_too_large", "Assistant output exceeded the persisted message limit");
  }
  return safe;
}

function appendStreamDelta(
  parts: AssistantPart[],
  type: "text" | "reasoning",
  text: string,
): AssistantPart[] {
  const previous = parts.at(-1);
  const candidate = previous?.type === type
    ? [...parts.slice(0, -1), { ...previous, text: previous.text + text }]
    : [...parts, { type, text }];
  return normalizeStreamingParts(candidate);
}

function appendDiagnostic(parts: AssistantPart[], code: string, message: string): AssistantPart[] {
  return normalizeAssistantParts([
    ...parts,
    { type: "error", code: code.slice(0, 128), message: message.slice(0, MAX_PERSISTED_ERROR_CHARS) },
  ]);
}

export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return jsonError("invalid_request", 400);
  }
  if (!body.message.trim() && body.attachmentFilenames.length === 0) return jsonError("message_required", 400);

  let currentAttachmentParts: AssistantPart[];
  try {
    currentAttachmentParts = await attachmentParts(body.attachmentFilenames);
  } catch (error) {
    const code = error instanceof AssistantSessionError ? error.code : "invalid_attachment";
    return jsonError(code, 400);
  }

  const requestedBinding = binding(body);
  let sessionId: string;
  let unstartedNewSessionId: string | null = null;
  const cleanupUnstartedSession = async () => {
    if (!unstartedNewSessionId) return;
    const pending = unstartedNewSessionId;
    unstartedNewSessionId = null;
    try { await assistantSessionService.deleteSession(pending); } catch { /* safe orphan cleanup is best-effort */ }
  };
  try {
    if (!body.sessionId) {
      sessionId = (await assistantSessionService.createSession(requestedBinding)).id;
      unstartedNewSessionId = sessionId;
    } else if (towerSessionIdSchema.safeParse(body.sessionId).success) {
      sessionId = body.sessionId;
      await assistantSessionService.getSession(sessionId);
      if (Object.keys(requestedBinding).length) {
        await assistantSessionService.updateSession(sessionId, { binding: requestedBinding });
      }
    } else {
      sessionId = (await assistantLegacyAdapter.import(body.sessionId, assistantSessionService)).id;
      if (Object.keys(requestedBinding).length) {
        await assistantSessionService.updateSession(sessionId, { binding: requestedBinding });
      }
    }
  } catch (error) {
    if (error instanceof AssistantSessionError) return jsonError(error.code, 400);
    return jsonError(body.sessionId ? "session_unavailable" : "session_create_failed", 400);
  }

  let userParts: AssistantPart[];
  try {
    userParts = normalizeAssistantParts([
      ...(body.message.trim() ? [{ type: "text" as const, text: body.message.trim() }] : []),
      ...currentAttachmentParts,
    ]);
  } catch (error) {
    await cleanupUnstartedSession();
    const code = error instanceof AssistantSessionError ? error.code : "invalid_request";
    return jsonError(code, 400);
  }

  let historyTurns: number;
  try {
    historyTurns = normalizeAssistantHistoryTurns(
      await readConfigValue<number>("assistant.historyTurns", 20),
    );
    await assistantSessionService.prepareHistory({
      sessionId,
      historyTurns,
      reserveBytes: Buffer.byteLength(JSON.stringify(userParts)) + MAX_ASSISTANT_MESSAGE_BYTES,
    });
  } catch (error) {
    await cleanupUnstartedSession();
    if (error instanceof AssistantSessionError) return jsonError(error.code, 400);
    return jsonError("history_unavailable", 500);
  }

  let history;
  try {
    history = trimAssistantHistory(await assistantSessionService.getMessages(sessionId));
  } catch (error) {
    await cleanupUnstartedSession();
    if (error instanceof AssistantSessionError) return jsonError(error.code, 400);
    return jsonError("history_unavailable", 500);
  }

  let session: Awaited<ReturnType<typeof assistantSessionService.getSessionView>>;
  let systemPrompt: string;
  let maxTurns: number;
  let maxOutputTokens: number;
  let maxOutputBytes: number;
  let effort: "low" | "medium" | "high";
  let towerMcpServer: ReturnType<typeof buildTowerMcpConfig>;
  try {
    session = await assistantSessionService.getSessionView(sessionId);
    const resolvedBinding: AssistantBinding = {
      ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
      ...(session.workspaceName ? { workspaceName: session.workspaceName } : {}),
      ...(session.projectId ? { projectId: session.projectId } : {}),
      ...(session.projectName ? { projectName: session.projectName } : {}),
      ...(session.versionId ? { versionId: session.versionId } : {}),
      ...(session.versionName ? { versionName: session.versionName } : {}),
    };
    [systemPrompt, maxTurns, maxOutputTokens, maxOutputBytes, effort] = await Promise.all([
      buildAssistantSystemPrompt(resolvedBinding),
      readConfigValue<number>("assistant.maxTurns", 30),
      readConfigValue<number>("assistant.maxOutputTokens", 128000),
      readConfigValue<number>("assistant.maxOutputBytes", 2 * 1024 * 1024),
      readConfigValue<"low" | "medium" | "high">("assistant.effort", "low"),
    ]);
    maxOutputBytes = Math.min(
      MAX_ASSISTANT_STREAM_BYTES,
      Math.max(1, Number.isFinite(maxOutputBytes) ? Math.trunc(maxOutputBytes) : MAX_ASSISTANT_STREAM_BYTES),
    );
    towerMcpServer = buildTowerMcpConfig({ profile: "assistant" });
  } catch {
    await cleanupUnstartedSession();
    return jsonError("assistant_configuration_unavailable", 500);
  }
  const apiHistory = assistantMessagesToApi(history);
  const currentMessage = body.message.trim() || "Please inspect the attachments included with this message.";
  const apiCurrentMessage = [currentMessage, currentAttachmentContext(currentAttachmentParts)].filter(Boolean).join("\n\n");
  const apiMessages = [...apiHistory, { role: "user" as const, content: apiCurrentMessage }];
  const cliPrompt = buildAssistantCliPrompt(apiHistory, currentMessage);

  let turn: Awaited<ReturnType<typeof assistantSessionService.beginTurn>>;
  try {
    turn = await assistantSessionService.beginTurn({
      sessionId,
      clientTurnId: body.clientTurnId ?? `server_${randomUUID()}`,
      userParts,
      historyTurns,
    });
  } catch (error) {
    await cleanupUnstartedSession();
    if (error instanceof AssistantSessionError) {
      const status = error.code === "turn_in_progress" || error.code === "turn_already_exists" ? 409 : 400;
      return jsonError(error.code, status);
    }
    return jsonError("turn_start_failed", 500);
  }
  unstartedNewSessionId = null;

  let closed = false;
  const abort = () => turn.controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let terminal = false;
      let parts: AssistantPart[] = [];
      let lastPersistedAt = 0;
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...event, sessionId })}\n\n`)); }
        catch { closed = true; abort(); }
      };
      const keepalive = setInterval(() => {
        if (!closed) {
          try { controller.enqueue(encoder.encode(": keepalive\n\n")); }
          catch { closed = true; abort(); }
        }
      }, 15_000);
      const persist = async (force = false) => {
        const now = Date.now();
        if (!force && now - lastPersistedAt < 250) return;
        lastPersistedAt = now;
        await assistantSessionService.updateAssistantMessage(turn.assistantMessageId, parts);
      };

      send({ type: "session" });
      try {
        for await (const event of streamAssistantTurn({
          prompt: cliPrompt,
          messages: apiMessages,
          cwd: ensureTowerDir(),
          correlationId: turn.turnId,
          systemPrompt,
          maxTurns,
          maxOutputTokens,
          maxOutputBytes,
          effort,
          signal: turn.controller.signal,
          towerMcpServer,
          attachments: body.attachmentFilenames,
          onAttempt: recordCapabilityAttemptService,
        })) {
          if (turn.controller.signal.aborted) break;
          if (event.type === "text") {
            const safeText = String(redactSecretValue(event.text));
            parts = appendStreamDelta(parts, "text", safeText);
            send({ type: "text_delta", content: safeText });
            await persist();
          } else if (event.type === "reasoning") {
            const safeText = String(redactSecretValue(event.text));
            parts = appendStreamDelta(parts, "reasoning", safeText);
            send({ type: "reasoning_delta", content: safeText });
            await persist();
          } else if (event.type === "tool-call") {
            const toolCallId = event.toolCall.id;
            const safeInput = redactSecretValue(event.toolCall.input);
            parts = normalizeStreamingParts([
              ...parts,
              { type: "tool-call", toolCallId, toolName: event.toolCall.name, input: safeInput },
            ]);
            await persist(true);
            send({ type: "tool_start", content: event.toolCall.name, toolId: toolCallId });
            send({ type: "tool_use", content: event.toolCall.name, toolId: toolCallId, toolInput: safeInput });
          } else if (event.type === "tool-result") {
            const toolCallId = event.toolResult.id;
            const matchingCall = parts.find((part): part is Extract<AssistantPart, { type: "tool-call" }> =>
              part.type === "tool-call" && part.toolCallId === toolCallId
            );
            const toolName = event.toolResult.name ?? matchingCall?.toolName ?? "tool";
            const output = redactSecretValue(event.toolResult.output ?? event.toolResult.error?.message ?? "");
            parts = normalizeStreamingParts([
              ...parts,
              { type: "tool-result", toolCallId, toolName, output, ...(event.toolResult.error ? { isError: true } : {}) },
            ]);
            await persist(true);
            send({ type: "tool_result", content: toolName, toolId: toolCallId, toolOutput: safeToolOutput(output), toolError: Boolean(event.toolResult.error) });
          } else if (event.type === "usage") {
            send({ type: "usage", usage: event.usage });
          } else if (event.type === "finish") {
            send({ type: "finish", finishReason: event.reason });
          } else if (event.type === "error") {
            const code = String(event.error.code || "provider_failure").slice(0, 128);
            const message = String(redactSecretValue(
              String(event.error.message || "Assistant execution failed"),
            )).slice(0, MAX_PERSISTED_ERROR_CHARS);
            parts = appendDiagnostic(parts, code, message);
            await assistantSessionService.finishTurn({
              sessionId, turnId: turn.turnId, assistantMessageId: turn.assistantMessageId,
              parts, status: code === "cancelled" ? "INTERRUPTED" : "FAILED", historyTurns,
            });
            terminal = true;
            if (code !== "cancelled") send({ type: "error", code, content: message });
            break;
          }
        }

        if (!terminal) {
          if (turn.controller.signal.aborted) {
            await assistantSessionService.finishTurn({
              sessionId, turnId: turn.turnId, assistantMessageId: turn.assistantMessageId,
              parts, status: "INTERRUPTED", historyTurns,
            });
          } else {
            await assistantSessionService.finishTurn({
              sessionId, turnId: turn.turnId, assistantMessageId: turn.assistantMessageId,
              parts, status: "COMPLETE", historyTurns,
            });
            send({ type: "done" });
          }
        }
      } catch (error) {
        const outputLimited = error instanceof AssistantSessionError && error.code === "message_too_large";
        if (outputLimited) abort();
        const interrupted = !outputLimited && (turn.controller.signal.aborted || closed);
        const code = outputLimited ? "output_limit" : "provider_failure";
        const message = outputLimited ? "Assistant output exceeded the persisted message limit" : "Assistant execution failed";
        const finalParts = interrupted ? parts : appendDiagnostic(parts, code, message);
        try {
          await assistantSessionService.finishTurn({
            sessionId, turnId: turn.turnId, assistantMessageId: turn.assistantMessageId,
            parts: finalParts, status: interrupted ? "INTERRUPTED" : "FAILED", historyTurns,
          });
        } catch { assistantSessionService.releaseTurn(sessionId, turn.turnId); }
        if (!interrupted) send({ type: "error", code, content: message });
      } finally {
        clearInterval(keepalive);
        request.signal.removeEventListener("abort", abort);
        assistantSessionService.releaseTurn(sessionId, turn.turnId);
        closed = true;
        try { controller.close(); } catch { /* transport already closed */ }
      }
    },
    cancel() {
      closed = true;
      abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
