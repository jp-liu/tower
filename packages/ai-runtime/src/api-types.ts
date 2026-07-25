export type ApiProtocol = "openai" | "openai-compatible" | "anthropic" | "google";

export type ApiErrorCode =
  | "connection_unavailable"
  | "authentication"
  | "permission"
  | "rate_limit"
  | "network"
  | "timeout"
  | "invalid_request"
  | "model_unavailable"
  | "content_safety"
  | "cancelled"
  | "tool_error"
  | "no_output"
  | "provider_failure"
  | "structured_output_invalid"
  | "unknown";

export interface ApiRuntimeErrorShape {
  code: ApiErrorCode;
  message: string;
  status?: number;
  cause?: string;
  retryableWithNextKey: boolean;
}

export interface ApiConfigEntry {
  id: string;
  name: string;
  value: string;
  enabled: boolean;
  sensitive: boolean;
}

export interface ApiConnectionRuntimeConfig {
  connectionId: string;
  protocol: ApiProtocol;
  name: string;
  baseUrl: string;
  headers: ApiConfigEntry[];
  queryParams: ApiConfigEntry[];
}

export interface ApiCredential {
  id: string;
  value: string;
}

export type ApiMessageContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string | Uint8Array; mediaType?: string }
  | { type: "file"; data: string | Uint8Array; mediaType: string; filename?: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | {
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output:
        | { type: "text" | "error-text"; value: string }
        | { type: "json" | "error-json"; value: unknown };
    };

export interface ApiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ApiMessageContentPart[];
}

export type JsonSchema = Record<string, unknown>;

export interface ApiToolDefinition {
  description?: string;
  inputSchema: JsonSchema;
  execute?: (input: unknown) => unknown | Promise<unknown>;
}

export interface ApiGenerateRequest {
  modelId: string;
  prompt?: string;
  messages?: ApiMessage[];
  system?: string;
  maxOutputTokens?: number;
  temperature?: number;
  effort?: "low" | "medium" | "high";
  timeoutMs?: number;
  /** Maximum model/tool-loop steps. Clamped to 1..20 by the runtime. */
  maxTurns?: number;
  abortSignal?: AbortSignal;
  tools?: Record<string, ApiToolDefinition>;
}

export interface ApiStructuredRequest extends ApiGenerateRequest {
  schema: JsonSchema;
  schemaName?: string;
  schemaDescription?: string;
}

export interface ApiToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface ApiToolResult {
  toolCallId: string;
  toolName: string;
  output: unknown;
  error?: { code: "tool_error"; message: string };
}

export interface ApiGenerateResult {
  text: string;
  reasoning?: string;
  toolCalls: ApiToolCall[];
  toolResults: ApiToolResult[];
  finishReason: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export type ApiStreamEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool-call"; call: ApiToolCall }
  | { type: "tool-result"; result: ApiToolResult }
  | { type: "usage"; usage: NonNullable<ApiGenerateResult["usage"]> }
  | { type: "finish"; finishReason: string }
  | { type: "error"; error: ApiRuntimeErrorShape };

export interface DiscoveredApiModel {
  id: string;
  capabilities?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type ModelDiscoveryResult =
  | { ok: true; models: DiscoveredApiModel[] }
  | { ok: false; models: []; error: ApiRuntimeErrorShape };

export interface ApiAttemptContext {
  credential: ApiCredential;
  onActivity: (activity?: ApiActivity) => void;
}

export type ApiActivity = "text" | "reasoning" | "tool_call" | "tool_result" | "other";

export interface ApiAdapter {
  readonly protocol: ApiProtocol;
  generate(request: ApiGenerateRequest, context: ApiAttemptContext): Promise<ApiGenerateResult>;
  stream(request: ApiGenerateRequest, context: ApiAttemptContext): AsyncIterable<ApiStreamEvent>;
  generateStructured(request: ApiStructuredRequest, context: ApiAttemptContext): Promise<unknown>;
  listModels(credential: ApiCredential): Promise<ModelDiscoveryResult>;
  testConnection(modelId: string, credential: ApiCredential, signal?: AbortSignal): Promise<ApiGenerateResult>;
}

export interface ApiRuntimeCursor {
  reserve(candidateCount: number): Promise<number>;
}

export interface ApiRuntimeExecutionContext {
  onActivity?: (activity?: ApiActivity) => void;
}
