import "server-only";

import { randomUUID } from "node:crypto";
import {
  capabilityError,
  executeWithCapabilityFallback,
  type AiCapabilitySlot,
  type CapabilityActivity,
  type CapabilityAttemptContext,
} from "@tower/ai-runtime";
import type { CliQueryResult } from "@tower/ai-sdk";
import {
  getApiRuntimeForResolvedTarget,
  resolveCapabilityPlan,
  type ResolvedCapabilityTarget,
} from "./capability-resolver";
import { recordCapabilityAttemptService } from "./capability-config-service";

export type OneShotCapabilitySlot = Exclude<AiCapabilitySlot, "terminal" | "assistant">;

export interface CapabilityTextRequest {
  slot: OneShotCapabilitySlot;
  prompt: string;
  cwd: string;
  correlationId?: string;
  systemPrompt?: string;
  model?: string;
  maxTurns?: number;
  maxOutputTokens?: number;
  maxOutputChars?: number;
  temperature?: number;
  signal?: AbortSignal;
  tools?: string[];
  allowedTools?: string[];
  onActivity?: (activity: CapabilityActivity) => void;
}

export interface CapabilityStructuredRequest<T> extends CapabilityTextRequest {
  schema: Record<string, unknown>;
  schemaName?: string;
  schemaDescription?: string;
  parse(value: unknown): T;
}

function targetModel(target: ResolvedCapabilityTarget, request: CapabilityTextRequest): string | undefined {
  return target.modelId ?? request.model;
}

function activityReporter(
  context: CapabilityAttemptContext,
  observer?: (activity: CapabilityActivity) => void,
) {
  const reported = new Set<CapabilityActivity>();
  return (activity: CapabilityActivity) => {
    context.onActivity(activity);
    if (!reported.has(activity)) {
      reported.add(activity);
      observer?.(activity);
    }
  };
}

function recordCliActivity(result: CliQueryResult, report: (activity: CapabilityActivity) => void): void {
  if (result.text?.trim()) report("text");
  if (result.reasoning?.trim()) report("reasoning");
  for (const call of result.toolCalls ?? []) {
    report("tool_call");
    if (call.output !== undefined) report("tool_result");
  }
}

function boundedText(text: string | null | undefined, maxOutputChars?: number): string {
  const clean = text?.trim() ?? "";
  if (!clean) throw capabilityError("no_output");
  if (maxOutputChars === undefined || clean.length <= maxOutputChars) return clean;
  return clean.slice(0, Math.max(1, maxOutputChars)).trimEnd();
}

function cliOptions(target: ResolvedCapabilityTarget, request: CapabilityTextRequest, prompt = request.prompt) {
  return {
    prompt,
    cwd: request.cwd,
    systemPrompt: request.systemPrompt,
    model: targetModel(target, request),
    maxTurns: request.maxTurns,
    maxOutputTokens: request.maxOutputTokens,
    maxOutputBytes: request.maxOutputChars ? Math.max(1024, request.maxOutputChars * 4) : undefined,
    temperature: request.temperature,
    tools: request.tools,
    allowedTools: request.allowedTools,
    signal: request.signal,
  };
}

function apiOptions(target: ResolvedCapabilityTarget, request: CapabilityTextRequest, prompt = request.prompt) {
  const modelId = targetModel(target, request);
  if (!modelId) throw capabilityError("invalid_request");
  return {
    modelId,
    prompt,
    system: request.systemPrompt,
    maxOutputTokens: request.maxOutputTokens,
    temperature: request.temperature,
    abortSignal: request.signal,
  };
}

async function executeTextTarget(
  target: ResolvedCapabilityTarget,
  context: CapabilityAttemptContext,
  request: CapabilityTextRequest,
): Promise<string> {
  const report = activityReporter(context, request.onActivity);
  if (target.kind === "cli") {
    if (!target.cli) throw capabilityError("connection_unavailable");
    const result = await target.cli.adapter.generate(cliOptions(target, request));
    recordCliActivity(result, report);
    return boundedText(result.text, request.maxOutputChars);
  }

  const runtime = await getApiRuntimeForResolvedTarget(target);
  const result = await runtime.generate(apiOptions(target, request), {
    onActivity: (activity = "other") => report(activity),
  });
  if (result.text?.trim()) report("text");
  if (result.reasoning?.trim()) report("reasoning");
  if (result.toolCalls.length) report("tool_call");
  if (result.toolResults.length) report("tool_result");
  return boundedText(result.text, request.maxOutputChars);
}

function stripSingleCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const firstLineEnd = trimmed.indexOf("\n");
  if (firstLineEnd < 0) return trimmed;
  const opening = trimmed.slice(0, firstLineEnd).trim();
  if (opening !== "```" && opening.toLowerCase() !== "```json") return trimmed;
  const closing = trimmed.lastIndexOf("```");
  if (closing <= firstLineEnd || trimmed.slice(closing + 3).trim()) return trimmed;
  return trimmed.slice(firstLineEnd + 1, closing).trim();
}

export function parseStructuredText(text: string): unknown {
  try {
    return JSON.parse(stripSingleCodeFence(text));
  } catch {
    throw capabilityError("structured_output_invalid");
  }
}

function validateStructured<T>(request: CapabilityStructuredRequest<T>, value: unknown): T {
  try {
    return request.parse(value);
  } catch {
    throw capabilityError("structured_output_invalid");
  }
}

function repairPrompt(request: CapabilityStructuredRequest<unknown>): string {
  return `${request.prompt}\n\nYour previous response was not valid for the required JSON schema. `
    + "Return exactly one valid JSON value matching the schema, with no markdown or explanation.";
}

async function executeStructuredTarget<T>(
  target: ResolvedCapabilityTarget,
  context: CapabilityAttemptContext,
  request: CapabilityStructuredRequest<T>,
  prompt = request.prompt,
): Promise<T> {
  const report = activityReporter(context, request.onActivity);
  if (target.kind === "cli") {
    if (!target.cli) throw capabilityError("connection_unavailable");
    const result = await target.cli.adapter.generate(cliOptions(target, request, prompt));
    recordCliActivity(result, report);
    const text = boundedText(result.text, request.maxOutputChars);
    return validateStructured(request, parseStructuredText(text));
  }

  const runtime = await getApiRuntimeForResolvedTarget(target);
  const value = await runtime.generateStructured({
    ...apiOptions(target, request, prompt),
    schema: request.schema,
    schemaName: request.schemaName,
    schemaDescription: request.schemaDescription,
  }, { onActivity: (activity = "other") => report(activity) });
  return validateStructured(request, value);
}

export async function generateCapabilityText(request: CapabilityTextRequest): Promise<string> {
  const requestId = randomUUID();
  const plan = await resolveCapabilityPlan(request.slot, { cwd: request.cwd });
  return executeWithCapabilityFallback({
    requestId,
    correlationId: request.correlationId,
    slot: request.slot,
    targets: plan.targets,
    execute: (target, context) => executeTextTarget(target, context, request),
    onAttempt: recordCapabilityAttemptService,
  });
}

export async function generateCapabilityStructured<T>(request: CapabilityStructuredRequest<T>): Promise<T> {
  const requestId = randomUUID();
  const plan = await resolveCapabilityPlan(request.slot, { cwd: request.cwd });
  return executeWithCapabilityFallback({
    requestId,
    correlationId: request.correlationId,
    slot: request.slot,
    targets: plan.targets,
    execute: (target, context) => executeStructuredTarget(target, context, request),
    repair: (target, context) => executeStructuredTarget(target, context, request, repairPrompt(request)),
    onAttempt: recordCapabilityAttemptService,
  });
}
