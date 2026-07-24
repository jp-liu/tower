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

export interface ApiMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
  timeoutMs?: number;
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
  | { type: "finish"; finishReason: string; usage?: ApiGenerateResult["usage"] };

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
  onActivity: () => void;
}

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
  onActivity?: () => void;
}
