import "server-only";

import { randomUUID } from "node:crypto";
import {
  capabilityError,
  normalizeCapabilityError,
  streamWithCapabilityFallback,
  type CapabilityActivity,
  type CapabilityAttemptContext,
  type CapabilityAttemptSummary,
} from "@tower/ai-runtime";
import type { ApiMessage, ApiStreamEvent } from "@tower/ai-runtime";
import type { CliQueryEvent, CliQueryOptions } from "@tower/ai-sdk";
import { assistantTowerToolCatalog } from "@/mcp/tool-catalog";
import { createAssistantToolBundle, prepareAssistantCliPrompt } from "./assistant-tool-bundle";
import {
  getApiRuntimeForResolvedTarget,
  resolveCapabilityPlan,
  type ResolvedCapabilityTarget,
} from "./capability-resolver";

export interface AssistantStreamRequest {
  prompt?: string;
  messages?: ApiMessage[];
  cwd: string;
  correlationId?: string;
  systemPrompt?: string;
  maxTurns?: number;
  maxOutputTokens?: number;
  maxOutputBytes?: number;
  timeoutMs?: number;
  temperature?: number;
  signal?: AbortSignal;
  towerMcpServerName?: string;
  attachments?: string[];
  onAttempt?: (attempt: CapabilityAttemptSummary) => void | Promise<void>;
}

const DEFAULT_ASSISTANT_TIMEOUT_MS = 5 * 60_000;
const MIN_ASSISTANT_TIMEOUT_MS = 1_000;
const MAX_ASSISTANT_TIMEOUT_MS = 30 * 60_000;

function boundedTimeoutMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_ASSISTANT_TIMEOUT_MS;
  return Math.min(MAX_ASSISTANT_TIMEOUT_MS, Math.max(MIN_ASSISTANT_TIMEOUT_MS, Math.trunc(value)));
}

function activity(event: CliQueryEvent): CapabilityActivity | false {
  if (event.type === "text") return "text";
  if (event.type === "reasoning") return "reasoning";
  if (event.type === "tool-call") return "tool_call";
  if (event.type === "tool-result") return "tool_result";
  return false;
}

function apiEvent(event: ApiStreamEvent): CliQueryEvent | null {
  if (event.type === "text") return { type: "text", text: event.delta };
  if (event.type === "reasoning") return { type: "reasoning", text: event.delta };
  if (event.type === "tool-call") {
    return { type: "tool-call", toolCall: { id: event.call.toolCallId, name: event.call.toolName, input: event.call.input } };
  }
  if (event.type === "tool-result") {
    return {
      type: "tool-result",
      toolResult: {
        id: event.result.toolCallId,
        name: event.result.toolName,
        output: event.result.output,
        ...(event.result.error ? { error: { code: "TOOL_ERROR", message: event.result.error.message } } : {}),
      },
    };
  }
  if (event.type === "usage") {
    return {
      type: "usage",
      usage: {
        inputTokens: event.usage.inputTokens,
        outputTokens: event.usage.outputTokens,
      },
    };
  }
  if (event.type === "finish") return { type: "finish", reason: event.finishReason };
  if (event.type === "error") throw normalizeCapabilityError(event.error);
  return null;
}

function towerCliTools(serverName: string): string[] {
  return Object.keys(assistantTowerToolCatalog).map((name) => `mcp__${serverName}__${name}`);
}

async function ensureCliTooling(target: ResolvedCapabilityTarget, request: AssistantStreamRequest): Promise<string[]> {
  if (!target.cli) throw capabilityError("connection_unavailable");
  const serverName = request.towerMcpServerName?.trim();
  if (!serverName || !target.cli.adapter.mcp) {
    throw { code: "TOOLING_UNAVAILABLE" };
  }
  const state = await target.cli.adapter.mcp.inspect({
    name: serverName,
    cwd: request.cwd,
    signal: request.signal,
    timeoutMs: boundedTimeoutMs(request.timeoutMs),
  });
  if (!state.installed || (state.status !== undefined && state.status !== "connected")) {
    throw { code: "TOOLING_UNAVAILABLE" };
  }
  return towerCliTools(serverName);
}

async function* executeTarget(
  target: ResolvedCapabilityTarget,
  context: CapabilityAttemptContext,
  request: AssistantStreamRequest,
): AsyncIterable<CliQueryEvent> {
  let source: AsyncIterable<CliQueryEvent>;
  const timeoutMs = boundedTimeoutMs(request.timeoutMs);
  if (target.kind === "cli") {
    if (!target.cli?.adapter.stream) throw capabilityError("invalid_request");
    const tools = await ensureCliTooling(target, request);
    let prompt: string;
    try {
      prompt = await prepareAssistantCliPrompt({ prompt: request.prompt ?? "", attachments: request.attachments });
    } catch {
      throw { code: "ATTACHMENT_UNAVAILABLE" };
    }
    const options: CliQueryOptions = {
      prompt,
      cwd: request.cwd,
      systemPrompt: request.systemPrompt,
      model: target.modelId,
      maxTurns: request.maxTurns,
      maxOutputTokens: request.maxOutputTokens,
      maxOutputBytes: request.maxOutputBytes,
      timeoutMs,
      temperature: request.temperature,
      tools,
      allowedTools: tools,
      signal: request.signal,
    };
    source = target.cli.adapter.stream(options);
  } else {
    if (!target.modelId) throw capabilityError("invalid_request");
    const runtime = await getApiRuntimeForResolvedTarget(target);
    const apiSource = runtime.stream({
      modelId: target.modelId,
      prompt: request.messages ? undefined : request.prompt ?? "",
      messages: request.messages,
      system: request.systemPrompt,
      maxTurns: request.maxTurns,
      maxOutputTokens: request.maxOutputTokens,
      temperature: request.temperature,
      timeoutMs,
      abortSignal: request.signal,
      tools: createAssistantToolBundle({ attachments: request.attachments }),
    }, { onActivity: (kind = "other") => context.onActivity(kind) });
    source = (async function* () {
      for await (const event of apiSource) {
        const mapped = apiEvent(event);
        if (mapped) yield mapped;
      }
    })();
  }

  const pending: CliQueryEvent[] = [];
  let active = false;
  for await (const event of source) {
    if (event.type === "error") throw normalizeCapabilityError(event.error);
    if (!activity(event)) {
      if (active) yield event;
      else pending.push(event);
      continue;
    }
    if (!active) {
      active = true;
      for (const buffered of pending.splice(0)) yield buffered;
    }
    yield event;
  }
  if (!active) throw capabilityError("no_output");
  for (const buffered of pending) yield buffered;
}

/** Provider-neutral Assistant stream with explicit-target fallback and first-activity locking. */
export async function* streamAssistantTurn(request: AssistantStreamRequest): AsyncIterable<CliQueryEvent> {
  try {
    const plan = await resolveCapabilityPlan("assistant", { cwd: request.cwd });
    for await (const event of streamWithCapabilityFallback({
      requestId: randomUUID(),
      correlationId: request.correlationId,
      slot: "assistant",
      targets: plan.targets,
      execute: (target, context) => executeTarget(target, context, request),
      activityFromEvent: activity,
      onAttempt: request.onAttempt,
    })) yield event;
  } catch (error) {
    const safe = normalizeCapabilityError(error);
    yield { type: "error", error: { code: safe.code, message: safe.message } };
  }
}
