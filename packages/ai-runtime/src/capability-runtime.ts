import { ApiRuntimeError } from "./api-errors.js";
import type {
  AiCapabilitySlot,
  CapabilityActivity,
  CapabilityAttemptContext,
  CapabilityAttemptSummary,
  CapabilityErrorCode,
  CapabilityErrorShape,
  CapabilityTarget,
} from "./capability-types.js";

const SAFE_MESSAGES: Record<CapabilityErrorCode, string> = {
  slot_unconfigured: "The AI capability slot is not configured",
  connection_disabled: "The configured connection is disabled",
  connection_unavailable: "The configured connection is unavailable",
  cli_not_found: "The configured CLI could not be found",
  cli_not_executable: "The configured CLI is not executable",
  spawn_failed: "The configured CLI could not be started",
  authentication: "Authentication failed",
  permission: "The connection does not have permission for this request",
  rate_limit: "The upstream service rate limit was reached",
  network: "The upstream service could not be reached",
  timeout: "The upstream request timed out",
  model_unavailable: "The selected model is unavailable",
  no_output: "The provider returned no usable output",
  provider_failure: "The provider could not complete the request",
  cancelled: "The request was cancelled",
  content_safety: "The request was rejected for content safety",
  invalid_request: "The request configuration is invalid",
  tooling_unavailable: "The configured tool connection is unavailable",
  attachment_unavailable: "The requested attachment cannot be safely provided to this connection",
  tool_error: "A tool execution failed",
  structured_output_invalid: "The structured response could not be parsed",
  unknown: "The provider request failed",
  fallback_blocked: "Fallback was not allowed after this attempt",
  not_needed: "The target was not needed",
};

const FALLBACK_CODES = new Set<CapabilityErrorCode>([
  "connection_disabled",
  "connection_unavailable",
  "cli_not_found",
  "cli_not_executable",
  "spawn_failed",
  "authentication",
  "permission",
  "rate_limit",
  "network",
  "timeout",
  "model_unavailable",
  "tooling_unavailable",
  "attachment_unavailable",
  "no_output",
  "provider_failure",
  "structured_output_invalid",
]);

const ERROR_CODE_ALIASES: Readonly<Record<string, CapabilityErrorCode>> = {
  CLI_NOT_FOUND: "cli_not_found",
  CLI_NOT_EXECUTABLE: "cli_not_executable",
  COMMAND_NOT_EXECUTABLE: "cli_not_executable",
  SPAWN_FAILED: "spawn_failed",
  PROCESS_TIMEOUT: "timeout",
  PROCESS_CANCELLED: "cancelled",
  PROCESS_OUTPUT_LIMIT: "provider_failure",
  QUERY_FAILED: "provider_failure",
  AUTH_REQUIRED: "authentication",
  AUTHENTICATION_FAILED: "authentication",
  API_KEY_MISSING: "authentication",
  PERMISSION_DENIED: "permission",
  MODEL_NOT_AVAILABLE: "model_unavailable",
  RATE_LIMITED: "rate_limit",
  NETWORK_ERROR: "network",
  TIMEOUT: "timeout",
  CONTENT_SAFETY: "content_safety",
  INVALID_REQUEST: "invalid_request",
  TOOL_ERROR: "tool_error",
  TOOLING_UNAVAILABLE: "tooling_unavailable",
  ATTACHMENT_UNAVAILABLE: "attachment_unavailable",
  CONNECTION_UNAVAILABLE: "connection_unavailable",
  NO_OUTPUT: "no_output",
  PROVIDER_FAILURE: "provider_failure",
  UNSUPPORTED_CAPABILITY: "invalid_request",
  INTEGRATION_FAILED: "provider_failure",
};

export const TERMINAL_PRESTART_FALLBACK_CODES = new Set<CapabilityErrorCode>([
  "connection_disabled",
  "connection_unavailable",
  "cli_not_found",
  "cli_not_executable",
  "spawn_failed",
]);

export class CapabilityRuntimeError extends Error {
  readonly code: CapabilityErrorCode;
  readonly attempts: readonly CapabilityAttemptSummary[];

  constructor(shape: CapabilityErrorShape, attempts: readonly CapabilityAttemptSummary[] = []) {
    super(shape.message);
    this.name = "CapabilityRuntimeError";
    this.code = shape.code;
    this.attempts = attempts.map((attempt) => ({ ...attempt }));
  }

  toJSON(): CapabilityErrorShape & { attempts: readonly CapabilityAttemptSummary[] } {
    return { code: this.code, message: this.message, attempts: this.attempts };
  }
}

export function capabilityError(code: CapabilityErrorCode): CapabilityRuntimeError {
  return new CapabilityRuntimeError({ code, message: SAFE_MESSAGES[code] });
}

export function normalizeCapabilityError(error: unknown): CapabilityRuntimeError {
  if (error instanceof CapabilityRuntimeError) return error;
  if (error instanceof ApiRuntimeError) {
    return capabilityError(error.code);
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return capabilityError("cancelled");
  }
  if (error && typeof error === "object" && "code" in error) {
    const rawCode = String(error.code);
    const code = ERROR_CODE_ALIASES[rawCode] ?? (rawCode as CapabilityErrorCode);
    if (code in SAFE_MESSAGES) return capabilityError(code);
  }
  return capabilityError("unknown");
}

export function canFallbackForCapabilityError(code: CapabilityErrorCode): boolean {
  return FALLBACK_CODES.has(code);
}

interface FallbackBaseOptions<TTarget extends CapabilityTarget> {
  requestId: string;
  correlationId?: string;
  slot: AiCapabilitySlot;
  targets: readonly TTarget[];
  onAttempt?: (attempt: CapabilityAttemptSummary) => void | Promise<void>;
  canFallback?: (code: CapabilityErrorCode) => boolean;
  now?: () => number;
}

export interface ExecuteFallbackOptions<TTarget extends CapabilityTarget, TResult>
  extends FallbackBaseOptions<TTarget> {
  execute(target: TTarget, context: CapabilityAttemptContext): Promise<TResult>;
  repair?: (
    target: TTarget,
    context: CapabilityAttemptContext,
    parseError: CapabilityRuntimeError,
  ) => Promise<TResult>;
}

export interface StreamFallbackOptions<TTarget extends CapabilityTarget, TEvent>
  extends FallbackBaseOptions<TTarget> {
  execute(target: TTarget, context: CapabilityAttemptContext): AsyncIterable<TEvent>;
  activityFromEvent?: (event: TEvent) => CapabilityActivity | false;
}

function defaultEventActivity(event: unknown): CapabilityActivity | false {
  if (!event || typeof event !== "object" || !("type" in event)) return false;
  const type = String(event.type);
  if (type === "text") return "text";
  if (type === "reasoning") return "reasoning";
  if (type === "tool-call" || type === "tool_call" || type === "tool_use") return "tool_call";
  if (type === "tool-result" || type === "tool_result") return "tool_result";
  return false;
}

function ordered<TTarget extends CapabilityTarget>(targets: readonly TTarget[]): TTarget[] {
  return [...targets].sort((left, right) => left.order - right.order);
}

function shapeFor(code: CapabilityErrorCode): CapabilityErrorShape {
  return { code, message: SAFE_MESSAGES[code] };
}

async function publish(
  attempts: CapabilityAttemptSummary[],
  attempt: CapabilityAttemptSummary,
  observer?: (attempt: CapabilityAttemptSummary) => void | Promise<void>,
): Promise<void> {
  attempts.push(attempt);
  try {
    await observer?.(attempt);
  } catch {
    // Diagnostics are best-effort and must never alter request behavior.
  }
}

function summary(
  options: FallbackBaseOptions<CapabilityTarget>,
  target: CapabilityTarget,
  startedAtMs: number,
  now: () => number,
  result: CapabilityAttemptSummary["result"],
  errorCode?: CapabilityErrorCode,
  repaired?: boolean,
): CapabilityAttemptSummary {
  return {
    requestId: options.requestId,
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    slot: options.slot,
    targetId: target.targetId,
    connectionId: target.connectionId,
    ...(target.modelId ? { modelId: target.modelId } : {}),
    startedAt: new Date(startedAtMs),
    durationMs: Math.max(0, now() - startedAtMs),
    result,
    ...(errorCode ? { errorCode } : {}),
    ...(repaired === undefined ? {} : { repaired }),
  };
}

async function publishRemaining<TTarget extends CapabilityTarget>(
  options: FallbackBaseOptions<TTarget>,
  targets: readonly TTarget[],
  startIndex: number,
  attempts: CapabilityAttemptSummary[],
  code: "not_needed" | "fallback_blocked",
  now: () => number,
): Promise<void> {
  for (const target of targets.slice(startIndex)) {
    const timestamp = now();
    await publish(attempts, summary(options, target, timestamp, now, "skipped", code), options.onAttempt);
  }
}

function blocksFallback(activities: ReadonlySet<CapabilityActivity>, structuredFailure: boolean): boolean {
  if (!structuredFailure) return activities.size > 0;
  return [...activities].some((activity) =>
    activity === "tool_call" || activity === "tool_result" || activity === "side_effect" || activity === "other"
  );
}

export async function executeWithCapabilityFallback<TTarget extends CapabilityTarget, TResult>(
  options: ExecuteFallbackOptions<TTarget, TResult>,
): Promise<TResult> {
  const targets = ordered(options.targets);
  if (targets.length === 0) throw capabilityError("slot_unconfigured");
  const attempts: CapabilityAttemptSummary[] = [];
  const now = options.now ?? Date.now;
  const mayFallback = options.canFallback ?? canFallbackForCapabilityError;
  let lastError = capabilityError("unknown");

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]!;
    const startedAt = now();
    if (target.preflightError) {
      lastError = new CapabilityRuntimeError(target.preflightError);
      await publish(attempts, summary(options, target, startedAt, now, "skipped", lastError.code), options.onAttempt);
      if (!mayFallback(lastError.code)) {
        await publishRemaining(options, targets, index + 1, attempts, "fallback_blocked", now);
        throw new CapabilityRuntimeError(shapeFor(lastError.code), attempts);
      }
      continue;
    }

    const activities = new Set<CapabilityActivity>();
    const context: CapabilityAttemptContext = {
      onActivity: (activity = "other") => { activities.add(activity); },
    };
    let repaired = false;
    try {
      const result = await options.execute(target, context);
      await publish(attempts, summary(options, target, startedAt, now, "selected"), options.onAttempt);
      await publishRemaining(options, targets, index + 1, attempts, "not_needed", now);
      return result;
    } catch (error) {
      lastError = normalizeCapabilityError(error);
      if (lastError.code === "structured_output_invalid" && options.repair) {
        repaired = true;
        try {
          const result = await options.repair(target, context, lastError);
          await publish(attempts, summary(options, target, startedAt, now, "selected", undefined, true), options.onAttempt);
          await publishRemaining(options, targets, index + 1, attempts, "not_needed", now);
          return result;
        } catch (repairError) {
          lastError = normalizeCapabilityError(repairError);
        }
      }

      await publish(
        attempts,
        summary(options, target, startedAt, now, "failed", lastError.code, repaired),
        options.onAttempt,
      );
      const structuredFailure = repaired || lastError.code === "structured_output_invalid";
      if (blocksFallback(activities, structuredFailure) || !mayFallback(lastError.code)) {
        await publishRemaining(options, targets, index + 1, attempts, "fallback_blocked", now);
        throw new CapabilityRuntimeError(shapeFor(lastError.code), attempts);
      }
    }
  }

  throw new CapabilityRuntimeError(shapeFor(lastError.code), attempts);
}

export async function* streamWithCapabilityFallback<TTarget extends CapabilityTarget, TEvent>(
  options: StreamFallbackOptions<TTarget, TEvent>,
): AsyncIterable<TEvent> {
  const targets = ordered(options.targets);
  if (targets.length === 0) throw capabilityError("slot_unconfigured");
  const attempts: CapabilityAttemptSummary[] = [];
  const now = options.now ?? Date.now;
  const mayFallback = options.canFallback ?? canFallbackForCapabilityError;
  const eventActivity = options.activityFromEvent ?? defaultEventActivity;
  let lastError = capabilityError("unknown");

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]!;
    const startedAt = now();
    if (target.preflightError) {
      lastError = new CapabilityRuntimeError(target.preflightError);
      await publish(attempts, summary(options, target, startedAt, now, "skipped", lastError.code), options.onAttempt);
      if (!mayFallback(lastError.code)) {
        await publishRemaining(options, targets, index + 1, attempts, "fallback_blocked", now);
        throw new CapabilityRuntimeError(shapeFor(lastError.code), attempts);
      }
      continue;
    }

    const activities = new Set<CapabilityActivity>();
    const context: CapabilityAttemptContext = {
      onActivity: (activity = "other") => { activities.add(activity); },
    };
    try {
      for await (const event of options.execute(target, context)) {
        const activity = eventActivity(event);
        if (activity) context.onActivity(activity);
        yield event;
      }
      await publish(attempts, summary(options, target, startedAt, now, "selected"), options.onAttempt);
      await publishRemaining(options, targets, index + 1, attempts, "not_needed", now);
      return;
    } catch (error) {
      lastError = normalizeCapabilityError(error);
      await publish(attempts, summary(options, target, startedAt, now, "failed", lastError.code), options.onAttempt);
      if (blocksFallback(activities, false) || !mayFallback(lastError.code)) {
        await publishRemaining(options, targets, index + 1, attempts, "fallback_blocked", now);
        throw new CapabilityRuntimeError(shapeFor(lastError.code), attempts);
      }
    }
  }

  throw new CapabilityRuntimeError(shapeFor(lastError.code), attempts);
}

export function executeTerminalPrestartFallback<TTarget extends CapabilityTarget, TResult>(
  options: Omit<ExecuteFallbackOptions<TTarget, TResult>, "slot" | "canFallback" | "repair">,
): Promise<TResult> {
  return executeWithCapabilityFallback({
    ...options,
    slot: "terminal",
    canFallback: (code) => TERMINAL_PRESTART_FALLBACK_CODES.has(code),
  });
}

export function resolveFixedTerminalTarget<TTarget extends CapabilityTarget>(
  targets: readonly TTarget[],
  connectionId: string,
): TTarget {
  const target = targets.find((candidate) => candidate.connectionId === connectionId);
  if (!target) throw capabilityError("connection_unavailable");
  return target;
}
