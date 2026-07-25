export const AI_CAPABILITY_SLOTS = [
  "terminal",
  "summary",
  "dreaming",
  "analysis",
  "assistant",
] as const;

export type AiCapabilitySlot = (typeof AI_CAPABILITY_SLOTS)[number];
export type CapabilityConnectionKind = "cli" | "api";

export interface CapabilityTarget {
  targetId: string;
  connectionId: string;
  modelId?: string;
  order: number;
  kind?: CapabilityConnectionKind;
  provider?: string;
  preflightError?: CapabilityErrorShape;
}

export type CapabilityActivity =
  | "text"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "side_effect"
  | "other";

export type CapabilityErrorCode =
  | "slot_unconfigured"
  | "connection_disabled"
  | "connection_unavailable"
  | "cli_not_found"
  | "cli_not_executable"
  | "spawn_failed"
  | "authentication"
  | "permission"
  | "rate_limit"
  | "network"
  | "timeout"
  | "model_unavailable"
  | "no_output"
  | "provider_failure"
  | "cancelled"
  | "content_safety"
  | "invalid_request"
  | "tooling_unavailable"
  | "attachment_unavailable"
  | "tool_error"
  | "structured_output_invalid"
  | "unknown"
  | "fallback_blocked"
  | "not_needed";

export interface CapabilityErrorShape {
  code: CapabilityErrorCode;
  message: string;
}

export type CapabilityAttemptResult = "selected" | "failed" | "skipped";

export interface CapabilityAttemptSummary {
  requestId: string;
  correlationId?: string;
  slot: AiCapabilitySlot;
  targetId: string;
  connectionId: string;
  modelId?: string;
  startedAt: Date;
  durationMs: number;
  result: CapabilityAttemptResult;
  errorCode?: CapabilityErrorCode;
  repaired?: boolean;
}

export interface CapabilityAttemptContext {
  onActivity(activity?: CapabilityActivity): void;
}

export function isAiCapabilitySlot(value: string): value is AiCapabilitySlot {
  return (AI_CAPABILITY_SLOTS as readonly string[]).includes(value);
}
